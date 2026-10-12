// Audit 1, live exposure (2026-10-11): what one hub must not show or allow
// inside itself. The leak harness proves hubs cannot see each other; these
// prove a hub's own visitors and residents cannot see or do what is an
// admin's.
//
//   A2  search finds only what is public: no pending brief, no unapproved
//       meeting summary, no admin notes, no recipient email;
//   A3  a resident calling an action their type does not open to residents
//       is refused, for every registered type;
//   A4  the Code of Conduct check cannot be skipped: it must have run on the
//       text being submitted, and a live edit needs it to have passed;
//   A8  an anonymous comment's moderation events name no author; an
//       archived or pending-review process serves no history by id; the
//       generic POST /reviews/submit is gone;
//   C2  signed-in non-admins never see a raw account id on the activity
//       surfaces; admins do.
//
// Rows are written straight into the local stack where the HTTP path to
// them is long (a brief awaiting approval, a meeting summary) — the test is
// about what the server then serves, not how the row got there.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { checkedHashFor } from "../fixtures/codeOfConduct.js";
import { getRegisteredTypes } from "../../src/processes/registry.js";

const HUB = "athens";
const HOST = "athens.localhost";
const ADMIN = "admin+athens@example.test";
const run = randomBytes(4).toString("hex");
/** A word no other row contains, so a hit can only be this test's. */
const word = (label: string) => `zq${label}${run}`;

let admin = "";
let resident = "";
let residentId = "";
/** Athens's meeting-summary switch before this file; on while it runs. */
let summariesBefore = "false";
const inserted: string[] = [];

type Row = Record<string, any>;

/** A bare process row. Archived after the file, so no later suite lists it. */
async function insertProcess(row: Row): Promise<string> {
  const id = `proc_audit${randomBytes(6).toString("hex")}`;
  inserted.push(id);
  await localRest("processes", {
    method: "POST",
    body: JSON.stringify({ id, hub_id: HUB, title: "Audit row", description: "", state: {}, ...row }),
  });
  return id;
}

async function search(q: string, token?: string): Promise<{ total: number; ids: string[] }> {
  const res = await call("GET", `/search?q=${encodeURIComponent(q)}`, HOST, undefined, token);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { total: res.body.total, ids: res.body.hits.map((h: Row) => h.process_id) };
}

beforeAll(async () => {
  admin = await mintSession(HUB, ADMIN);
  resident = await mintSession(HUB, `audit-resident-${run}@example.test`);
  const me = await call("GET", "/auth/me", HOST, undefined, resident);
  residentId = me.body.id ?? me.body.user?.id;
  expect(residentId).toMatch(/^user_/);
  // Every type's plugin on, so no check below passes because a type is off.
  summariesBefore = (await call("GET", "/hub-config", HOST)).body.settings["plugin.meeting_summary.enabled"] ?? "false";
  await setPlugins({ "plugin.meeting_summary.enabled": "true" });
});

afterAll(async () => {
  await setPlugins({ "plugin.meeting_summary.enabled": summariesBefore });
  if (inserted.length > 0) {
    await localRest(`processes?id=in.(${inserted.join(",")})`, {
      method: "PATCH",
      body: JSON.stringify({ status: "archived" }),
    });
  }
});

async function setPlugins(values: Record<string, string>): Promise<void> {
  const res = await call("PUT", "/admin/hub/settings", HOST, { section: "plugins", values }, admin);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

// --- A2 -----------------------------------------------------------------------

describe("A2: search finds only what is public", () => {
  const recipient = `council-${run}@example.test`;
  let published = "";
  let publishedSummary = "";

  beforeAll(async () => {
    await insertProcess({
      type: "civic.brief",
      status: "active",
      title: `Pending ${word("pendingbrief")}`,
      state: {
        publication_status: "pending",
        content: { headline: word("pendingbrief"), summary: "x", sections: [], comments: [], admin_notes: word("notesonpending") },
        recipients: [{ email: recipient }],
      },
    });
    await insertProcess({
      type: "civic.vote_results",
      status: "active",
      title: "Pending results",
      state: { publication_status: "approved", content: { admin_notes: word("resultsnotes"), comments: [] } },
    });
    await insertProcess({
      type: "civic.meeting_summary",
      status: "active",
      title: `Meeting ${word("pendingsummary")}`,
      state: { approval_status: "pending", blocks: [{ topic_title: word("pendingsummary") }], admin_notes: word("summarynotes") },
    });
    publishedSummary = await insertProcess({
      type: "civic.meeting_summary",
      status: "active",
      title: "Approved meeting",
      state: { approval_status: "published", blocks: [{ topic_title: word("approvedsummary") }] },
    });
    published = await insertProcess({
      type: "civic.brief",
      status: "active",
      title: "Published brief",
      state: {
        publication_status: "published",
        content: { headline: word("publishedbrief"), summary: "y", sections: [], comments: [] },
        recipients: [{ email: recipient }],
        delivered_to: [recipient],
        moderation: { reason: word("modreason") },
      },
    });
  });

  for (const who of ["a visitor", "a resident", "an admin"] as const) {
    it(`for ${who}: no pending brief or summary, no admin notes, no recipient email`, async () => {
      const token = who === "a resident" ? resident : who === "an admin" ? admin : undefined;
      for (const q of [
        word("pendingbrief"),
        word("notesonpending"),
        word("resultsnotes"),
        word("pendingsummary"),
        word("summarynotes"),
        word("modreason"),
        recipient,
      ]) {
        expect((await search(q, token)).total, q).toBe(0);
      }
      // The control: the same kind of record, published, is found by its public text.
      expect((await search(word("publishedbrief"), token)).ids).toEqual([published]);
      expect((await search(word("approvedsummary"), token)).ids).toEqual([publishedSummary]);
    });
  }
});

// --- A3 -----------------------------------------------------------------------

describe("A3: a resident can call only resident actions", () => {
  /** An action each type does NOT open to residents. */
  const REFUSED: Record<string, string[]> = {
    "civic.vote": ["process.close", "process.activate", "process.propose"],
    "civic.wordcloud": ["process.close", "process.snapshot", "process.activate"],
    "civic.polis_deliberation": ["start", "close", "poll_state", "regenerate_summary"],
  };

  it("covers every registered type", () => {
    expect(getRegisteredTypes().length).toBeGreaterThanOrEqual(9);
  });

  for (const type of getRegisteredTypes()) {
    it(`${type}: refused with 403, and the process is untouched`, async () => {
      const id = await insertProcess({ type, status: "active", title: `Actions ${type} ${run}` });
      for (const action of REFUSED[type] ?? ["process.close"]) {
        const res = await call("POST", `/process/${id}/action`, HOST, { type: action, payload: {} }, resident);
        expect(res.status, `${type} ${action}: ${JSON.stringify(res.body)}`).toBe(403);
      }
      const [row] = (await localRest(`processes?select=status&id=eq.${id}`)) as Row[];
      expect(row.status).toBe("active");
    });
  }

  it("an admin is not held to the resident list", async () => {
    const id = await insertProcess({ type: "civic.polis_deliberation", status: "closed", title: `Admin ${run}` });
    const res = await call("POST", `/process/${id}/action`, HOST, { type: "start", payload: {} }, admin);
    // Not the resident refusal: the handler's own status rule answers (a conflict since Audit 4).
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Cannot start a conversation that is closed/);
  });
});

// --- A4 -----------------------------------------------------------------------

describe("A4: the Code of Conduct check cannot be skipped", () => {
  async function proposalDraft(): Promise<string> {
    const draft = await call("POST", "/proposals/drafts", HOST, { category: "idea" }, resident);
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    return draft.body.id;
  }
  const fields = { title: `Benches ${run}`, description: "By the bus stop." };
  const fakePass = (id: string, result: unknown[] = []) =>
    localRest(`proposal_drafts?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...fields,
        last_review_result: result,
        draft_modified_since_review: false,
        coc_checked_hash: checkedHashFor(fields),
      }),
    });
  const submit = (id: string) => call("POST", `/proposals/drafts/${id}/submit`, HOST, {}, resident);

  it("a brand-new draft is refused until the check has run", async () => {
    const id = await proposalDraft();
    await call("PATCH", `/proposals/drafts/${id}`, HOST, fields, resident);
    const res = await submit(id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Run the Code of Conduct check/);
  });

  it("skip_modified_flag from the client is ignored: an edited draft needs the check again", async () => {
    const id = await proposalDraft();
    await fakePass(id);
    const patch = await call(
      "PATCH",
      `/proposals/drafts/${id}`,
      HOST,
      { description: "Something the check never read.", skip_modified_flag: true },
      resident,
    );
    expect(patch.status).toBe(200);
    expect(patch.body.draft_modified_since_review).toBe(true);
    const res = await submit(id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/modified since last review/);
  });

  it("a text change written behind the flag's back is still caught by the hash", async () => {
    const id = await proposalDraft();
    await fakePass(id);
    // As if an autosave landed while the check ran: the flag says clean.
    await localRest(`proposal_drafts?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ description: "Changed mid-check.", draft_modified_since_review: false }),
    });
    expect((await submit(id)).status).toBe(400);
  });

  it("a links-only edit leaves a passed check standing", async () => {
    const id = await proposalDraft();
    await fakePass(id);
    const patch = await call("PATCH", `/proposals/drafts/${id}`, HOST, { links: [] }, resident);
    expect(patch.body.draft_modified_since_review).toBe(false);
    const res = await submit(id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it("a live edit needs a check that PASSED, not one that was unavailable", async () => {
    const draft = await call("POST", "/projects/drafts", HOST, {}, resident);
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const project = { title: `Garden ${run}`, description: "A community garden." };
    await localRest(`project_drafts?id=eq.${draft.body.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...project,
        last_review_result: [{ severity: "soft", check_unavailable: true, message: "could not run" }],
        draft_modified_since_review: false,
        coc_checked_hash: checkedHashFor(project),
      }),
    });
    const live = await insertProcess({ type: "civic.project", status: "active", created_by: residentId });
    const res = await call(
      "POST",
      `/projects/drafts/${draft.body.id}/submit`,
      HOST,
      { edit_process_id: live },
      resident,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/couldn't run/);
  });
});

// --- A8 -----------------------------------------------------------------------

describe("A8: anonymous stays anonymous in moderation events", () => {
  it("hiding and restoring an anonymous comment writes no author id", async () => {
    const pid = await insertProcess({ type: "civic.vote", status: "active", title: `Comments ${run}` });
    const anon = `inp_audit${randomBytes(5).toString("hex")}`;
    const named = `inp_audit${randomBytes(5).toString("hex")}`;
    for (const [id, is_anonymous] of [[anon, true], [named, false]] as const) {
      await localRest("community_inputs", {
        method: "POST",
        body: JSON.stringify({ id, hub_id: HUB, process_id: pid, author_id: residentId, body: "A comment.", is_anonymous }),
      });
      for (const step of ["hide", "restore"]) {
        const res = await call("POST", `/admin/moderation/comments/${id}/${step}`, HOST, { reason: "Off topic" }, admin);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      }
    }
    const events = (await localRest(
      `events?select=data&process_id=eq.${pid}&event_type=eq.civic.process.updated`,
    )) as Row[];
    const targets = events.map((e) => e.data?.moderation?.target).filter(Boolean);
    const anonTargets = targets.filter((t) => t.comment_id === anon);
    const namedTargets = targets.filter((t) => t.comment_id === named);
    expect(anonTargets).toHaveLength(2);
    expect(JSON.stringify(anonTargets)).not.toContain(residentId);
    // A named comment's author is still recorded for moderation.
    expect(namedTargets.every((t) => t.comment_author_id === residentId)).toBe(true);
  });
});

describe("A8: a non-public process serves no history by id", () => {
  for (const status of ["archived", "pending_review"]) {
    it(`${status}: /events?context=, /activities/:id and /api/feed?process_id= are empty`, async () => {
      const pid = await insertProcess({ type: "civic.vote", status: "active", title: `History ${status} ${run}` });
      const comment = await call("POST", `/process/${pid}/input`, HOST, { body: "Before it was hidden." }, resident);
      expect(comment.status, JSON.stringify(comment.body)).toBe(201);
      const [event] = (await localRest(`events?select=id&process_id=eq.${pid}&limit=1`)) as Row[];
      expect(event?.id).toBeTruthy();
      // Served while public.
      expect((await call("GET", `/activities/${event.id}`, HOST)).status).toBe(200);

      await localRest(`processes?id=eq.${pid}`, { method: "PATCH", body: JSON.stringify({ status }) });
      for (const token of [undefined, resident, admin]) {
        const page = await call("GET", `/events?context=${pid}&page=true`, HOST, undefined, token);
        expect(page.status).toBe(200);
        expect(page.body.orderedItems).toEqual([]);
        const collection = await call("GET", `/events?context=${pid}`, HOST, undefined, token);
        expect(collection.body.totalItems).toBe(0);
        expect((await call("GET", `/activities/${event.id}`, HOST, undefined, token)).status).toBe(404);
        const feed = await call("GET", `/api/feed?process_id=${pid}`, HOST, undefined, token);
        expect(feed.body.events).toEqual([]);
      }
    });
  }
});

describe("A8: the generic review submit is gone", () => {
  it("POST /reviews/submit is not a route", async () => {
    const res = await call(
      "POST",
      "/reviews/submit",
      HOST,
      { process_type: "civic.vote", title: "Raw", description: "Raw", state: {} },
      resident,
    );
    expect(res.status).toBe(404);
  });
});

// --- C2 -----------------------------------------------------------------------

describe("C2: account ids are hidden from everyone but hub admins", () => {
  let pid = "";
  beforeAll(async () => {
    pid = await insertProcess({ type: "civic.vote", status: "active", title: `Ids ${run}` });
    const res = await call("POST", `/process/${pid}/input`, HOST, { body: "A named comment." }, resident);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it("a signed-in resident and a visitor never see the raw id; an admin does", async () => {
    for (const token of [undefined, resident]) {
      const page = await call("GET", `/events?context=${pid}&page=true`, HOST, undefined, token);
      expect(page.body.orderedItems.length).toBeGreaterThan(0);
      expect(JSON.stringify(page.body)).not.toContain(residentId);
      const feed = await call("GET", `/api/feed?process_id=${pid}`, HOST, undefined, token);
      expect(feed.body.events.length).toBeGreaterThan(0);
      expect(JSON.stringify(feed.body)).not.toContain(residentId);
      const id = page.body.orderedItems[0].id.split("/activities/")[1];
      const one = await call("GET", `/activities/${id}`, HOST, undefined, token);
      expect(JSON.stringify(one.body)).not.toContain(residentId);
    }
    const adminPage = await call("GET", `/events?context=${pid}&page=true`, HOST, undefined, admin);
    expect(JSON.stringify(adminPage.body)).toContain(residentId);
  });

  it("the same resident is the same token within one process, for a member", async () => {
    await call("POST", `/process/${pid}/input`, HOST, { body: "A second comment." }, resident);
    const page = await call("GET", `/events?context=${pid}&page=true&type=civic.process.comment_added`, HOST, undefined, resident);
    const actors = new Set(page.body.orderedItems.map((a: Row) => a.actor));
    expect(actors.size).toBe(1);
  });
});
