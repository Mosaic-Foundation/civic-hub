// Demo hubs stay current, for every kind, and a visitor's submission goes
// live (2026-10-07, session 3b; review issue #9, R18, R25, R46, issue #7).
//
// Through the paths an operator and a visitor use: hubs made by the console's
// Create hub, the daily job's route (`/internal/sample-refresh/run?hub=`), the
// console's "Refresh samples", a visitor's proposal draft submitted on demo,
// beta and live hubs, and the hub admin's sample removal.
//
// Needs the console on console.localhost (CI's env) and the local stack, and
// a server that runs crons (the cron secret as in crons.test.ts). Every hub
// this file creates is archived in afterAll.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { api } from "../fixtures/helpers.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";

const run = Date.now().toString(36);
const DEMO = `srd-${run}`;
const BETA = `srb-${run}`;
const LIVE = `srl-${run}`;
const EMPTY = `sre-${run}`;
const ORG = `sro-${run}`;
const ISSUE = `sri-${run}`;
const host = (slug: string) => `${slug}.localhost`;
const ADMIN = `refresh-admin-${run}@example.test`;
const VISITOR = `refresh-visitor-${run}@example.test`;
const created: string[] = [];
let cookie = "";

const CRON_SECRET = process.env.CIVIC_TEST_CRON_SECRET ?? "ci-only-cron-secret";
const DAY = 24 * 60 * 60 * 1000;

type Row = Record<string, any>;

async function stepCode(): Promise<string> {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantCode("step_up", code);
  return code;
}

async function createHub(slug: string, body: Row): Promise<Row> {
  const res = await consoleCall("POST", "/control/hubs", {
    cookie,
    body: { slug, hostname: host(slug), admin_email: ADMIN, ...body },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.push(slug);
  return res.body;
}

const placeHub = (name: string) => ({
  name,
  jurisdiction_name: "Example County, Ohio",
  jurisdiction_custom: true,
  jurisdiction_type: "county",
});

/** The job's own route, for one hub, as Vercel Cron calls it. */
async function runJob(slug: string): Promise<{ status: number; body: Row }> {
  const res = await api(`/internal/sample-refresh/run?hub=${slug}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  return { status: res.status, body: (await res.json()) as Row };
}

const pid = (slug: string, key: string) => `proc_sample_${slug}_${key}`;

async function processRow(id: string): Promise<Row | undefined> {
  return ((await localRest(`processes?select=id,status,state,created_at,is_sample,added_in_demo&id=eq.${id}`)) as Row[])[0];
}

let cronsEnabled = true;

beforeAll(async () => {
  cookie = await mintConsoleSession();
  await createHub(DEMO, { ...placeHub("Refresh Demo Civic Hub"), sample_content: true });
  await createHub(BETA, { ...placeHub("Refresh Beta Civic Hub"), sample_content: true, mode: "beta" });
  await createHub(LIVE, { ...placeHub("Refresh Live Civic Hub"), mode: "live" });
  // The job's kill switch answers 200 with `disabled` and runs nothing.
  const probe = await runJob(DEMO);
  cronsEnabled = probe.status === 200 && !probe.body.disabled && probe.body.hubs !== undefined;
});

afterAll(async () => {
  for (const id of created) {
    const res = await consoleCall("POST", `/control/hubs/${id}/archive`, { cookie, body: { step_up_code: await stepCode() } });
    if (res.status !== 200 && !/already archived/.test(res.body.error ?? "")) {
      throw new Error(`could not archive ${id}: ${JSON.stringify(res.body)}`);
    }
  }
});

describe("samples for every kind of hub", () => {
  it("seeds an organization, an issue campaign and a school district with their own sets", async () => {
    const org = await createHub(ORG, { name: "Refresh Tenants Association", hub_kind: "organization", sample_content: true });
    expect(org.sample_content.created).toHaveLength(10);
    expect(org.sample_content.created).toContain("org_vote_meeting_times");
    const issue = await createHub(ISSUE, { name: "Refresh Campaign", hub_kind: "issue", sample_content: true });
    expect(issue.sample_content.created).toHaveLength(10);
    expect(issue.sample_content.created).toContain("issue_deliberation_disagree");
    // No placeholder left, and no place on a hub that has none.
    const procs = (await localRest(`processes?select=title,description&hub_id=in.(${ORG},${ISSUE})`)) as Row[];
    const text = procs.map((p) => `${p.title} ${p.description}`).join("\n");
    expect(text).not.toMatch(/\{[A-Z_]+\}/);
    expect(text).not.toMatch(/\bresidents?\b/i);
  });
});

describe("the sample meeting summary (issue #7)", () => {
  it("serves minutes to read, and still no recording address", async () => {
    const res = await call("GET", `/meeting-summary/${pid(DEMO, "meeting_summary_regular")}`, host(DEMO));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.is_sample).toBe(true);
    expect(res.body.source_video_url).toBeNull();
    expect(res.body.sample_minutes).toMatch(/Call to order/);
    expect(res.body.sample_minutes).toContain("Road resurfacing contract");
    expect(res.body.sample_minutes).not.toMatch(/\{[A-Z_]+\}/);
  });
});

describe("the daily sample refresh", () => {
  const OPEN = () => pid(DEMO, "vote_internet");
  const ENDORSING = () => pid(DEMO, "vote_fire_rescue");
  const PROPOSAL = () => pid(DEMO, "proposal_repair_list");
  const CLOSED = () => pid(DEMO, "vote_library_hours");
  let closedBefore: Row | undefined;
  let visitorId = "";

  beforeAll(async () => {
    closedBefore = await processRow(CLOSED());
    // A visitor took part in the open vote and endorsed the proposal.
    await mintSession(DEMO, VISITOR);
    visitorId = ((await localRest(`users?select=id&hub_id=eq.${DEMO}&email=eq.${VISITOR}`)) as Row[])[0].id;
    await localRest("vote_participation", {
      method: "POST",
      body: JSON.stringify({ hub_id: DEMO, process_id: OPEN(), user_id: visitorId, has_voted: true }),
    });
    // The open vote closes tomorrow; the proposal in two days; the endorsement
    // vote has been opened by endorsements.
    const open = await processRow(OPEN());
    await localRest(`processes?id=eq.${OPEN()}`, {
      method: "PATCH",
      body: JSON.stringify({ state: { ...open!.state, voting_closes_at: new Date(Date.now() + DAY).toISOString() } }),
    });
    await localRest(`proposals?id=eq.${PROPOSAL()}`, {
      method: "PATCH",
      body: JSON.stringify({ closes_at: new Date(Date.now() + 2 * DAY).toISOString() }),
    });
    await localRest(`processes?id=eq.${ENDORSING()}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) });
  });

  it("replaces the near-deadline samples with fresh copies under the same ids", async (ctx) => {
    if (!cronsEnabled) return ctx.skip();
    const res = await runJob(DEMO);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const report = res.body.hubs[DEMO];
    expect(report.replaced.map((r: Row) => r.key).sort()).toEqual(
      ["proposal_repair_list", "vote_fire_rescue", "vote_internet"].sort(),
    );

    const open = await processRow(OPEN());
    expect(open?.status).toBe("active");
    expect(new Date(open!.state.voting_closes_at).getTime()).toBeGreaterThan(Date.now() + 3 * DAY);
    expect(open!.state.total_votes).toBe(30);
    const [proposal] = (await localRest(`proposals?select=closes_at&id=eq.${PROPOSAL()}`)) as Row[];
    expect(new Date(proposal.closes_at).getTime()).toBeGreaterThan(Date.now() + 3 * DAY);
    expect((await processRow(ENDORSING()))?.status).toBe("proposed");
  });

  it("takes the visitor's input on a replaced sample with it", async (ctx) => {
    if (!cronsEnabled) return ctx.skip();
    const left = (await localRest(`vote_participation?select=user_id&process_id=eq.${OPEN()}&user_id=eq.${visitorId}`)) as Row[];
    expect(left).toHaveLength(0);
  });

  it("keeps the required mix, and leaves the closed vote alone", async (ctx) => {
    if (!cronsEnabled) return ctx.skip();
    const rows = (await localRest(`processes?select=id,type,status&hub_id=eq.${DEMO}&is_sample=is.true`)) as Row[];
    const status = (key: string) => rows.find((r) => r.id === pid(DEMO, key))?.status;
    expect(status("vote_internet")).toBe("active");
    expect(status("vote_fire_rescue")).toBe("proposed");
    expect(status("proposal_repair_list")).toBe("active");
    expect(status("deliberation_rentals")).toBe("active");
    expect(status("vote_library_hours")).toBe("finalized");
    expect(rows.filter((r) => r.type === "civic.brief").length).toBeGreaterThanOrEqual(1);
    const closed = await processRow(CLOSED());
    expect(closed?.created_at).toBe(closedBefore?.created_at);
  });

  it("records the run in job_runs, and nothing when there is nothing to do", async (ctx) => {
    if (!cronsEnabled) return ctx.skip();
    const runs = (await localRest(
      `job_runs?select=status,summary&hub_id=eq.${DEMO}&job_id=eq.sample_refresh&order=started_at.desc`,
    )) as Row[];
    expect(runs[0]).toMatchObject({ status: "ok", summary: "3 samples replaced with a fresh copy" });
    const again = await runJob(DEMO);
    expect(again.body.hubs[DEMO].replaced).toEqual([]);
    const after = (await localRest(`job_runs?select=id&hub_id=eq.${DEMO}&job_id=eq.sample_refresh`)) as Row[];
    expect(after).toHaveLength(runs.length);
    // No hub_admin_audit_log rows for refreshes (Adam).
    const audit = (await localRest(`hub_admin_audit_log?select=action&hub_id=eq.${DEMO}`)) as Row[];
    expect(audit.map((a) => a.action)).not.toContain("sample_refresh");
  });

  it("never touches a beta or live hub", async (ctx) => {
    if (!cronsEnabled) return ctx.skip();
    const open = await processRow(pid(BETA, "vote_internet"));
    const soon = new Date(Date.now() + DAY).toISOString();
    await localRest(`processes?id=eq.${pid(BETA, "vote_internet")}`, {
      method: "PATCH",
      body: JSON.stringify({ state: { ...open!.state, voting_closes_at: soon } }),
    });
    const res = await runJob(BETA);
    expect(res.status).toBe(200);
    expect(res.body.hubs[BETA].skipped).toMatch(/not a demo hub/);
    expect((await processRow(pid(BETA, "vote_internet")))?.state.voting_closes_at).toBe(soon);
    expect((await localRest(`job_runs?select=id&hub_id=eq.${BETA}&job_id=eq.sample_refresh`)) as Row[]).toHaveLength(0);
  });
});

describe("the console's Refresh samples", () => {
  it("adds every missing template to a demo hub, and gives an old sample summary its minutes", async () => {
    await createHub(EMPTY, { ...placeHub("Refresh Empty Civic Hub"), sample_content: false });
    expect((await localRest(`processes?select=id&hub_id=eq.${EMPTY}`)) as Row[]).toHaveLength(0);
    const res = await consoleCall("POST", `/control/hubs/${EMPTY}/samples/refresh`, { cookie, body: {} });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.refresh.added).toHaveLength(11);
    const again = await consoleCall("POST", `/control/hubs/${EMPTY}/samples/refresh`, { cookie, body: {} });
    expect(again.body.refresh).toMatchObject({ replaced: [], added: [], minutes_added: [] });

    // A summary seeded before it had minutes (agora's).
    const id = pid(EMPTY, "meeting_summary_regular");
    const row = await processRow(id);
    const { sample_minutes: _gone, ...state } = row!.state;
    await localRest(`processes?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ state }) });
    const third = await consoleCall("POST", `/control/hubs/${EMPTY}/samples/refresh`, { cookie, body: {} });
    expect(third.body.refresh.minutes_added).toEqual(["meeting_summary_regular"]);
    expect((await processRow(id))?.state.sample_minutes).toMatch(/Call to order/);
    // Recorded like the job's run.
    const runs = (await localRest(`job_runs?select=summary&hub_id=eq.${EMPTY}&job_id=eq.sample_refresh`)) as Row[];
    expect(runs.length).toBe(2);
  });

  it("refuses a hub that is not a demo", async () => {
    const res = await consoleCall("POST", `/control/hubs/${LIVE}/samples/refresh`, { cookie, body: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/demo hubs only/);
    expect((await localRest(`processes?select=id&hub_id=eq.${LIVE}`)) as Row[]).toHaveLength(0);
  });
});

describe("a visitor's submission", () => {
  /** Draft a proposal that passed the Code of Conduct check, and submit it. */
  async function submitProposal(slug: string, email: string, coc: unknown[] | null = []): Promise<Row> {
    const token = await mintSession(slug, email);
    const draft = await call("POST", "/proposals/drafts", host(slug), { category: "idea" }, token);
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    await localRest(`proposal_drafts?id=eq.${draft.body.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: `A visitor's idea ${run}`,
        description: "Put a bench by the bus stop.",
        last_review_result: coc,
        draft_modified_since_review: false,
      }),
    });
    const res = await call("POST", `/proposals/drafts/${draft.body.id}/submit`, host(slug), {}, token);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  }

  it("publishes on a demo hub once the check passed, as demo content without the Sample badge", async () => {
    const result = await submitProposal(DEMO, `visitor-a-${run}@example.test`);
    expect(result.auto_approved).toBe(true);
    const row = await processRow(result.process_id);
    expect(row).toMatchObject({ status: "active", is_sample: true, added_in_demo: true });
    // Live: its own page, the list, and the hub's feed, with no Sample badge.
    const page = await call("GET", `/proposals/${result.process_id}`, host(DEMO));
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    expect(page.body.is_sample).toBeUndefined();
    const feed = await call("GET", `/api/feed?process_id=${result.process_id}`, host(DEMO));
    expect(feed.body.events.length).toBeGreaterThan(0);
    expect(feed.body.events.every((e: Row) => e.sample !== true)).toBe(true);
    // Never on the public wire.
    const wire = (await localRest(`events?select=is_sample&process_id=eq.${result.process_id}`)) as Row[];
    expect(wire.every((e) => e.is_sample === true)).toBe(true);
  });

  it("still waits for review on a demo hub when the check never ran or was unavailable", async () => {
    const unavailable = {
      severity: "soft",
      quoted_text: null,
      field: null,
      message: "The automated Code of Conduct check could not run.",
      suggested_revision: null,
      check_unavailable: true,
    };
    const result = await submitProposal(DEMO, `visitor-b-${run}@example.test`, [unavailable]);
    expect(result.auto_approved).toBe(false);
    expect((await processRow(result.process_id))?.status).toBe("pending_review");
  });

  it("goes to review on a beta and a live hub", async () => {
    const beta = await submitProposal(BETA, `visitor-c-${run}@example.test`);
    expect(beta.auto_approved).toBe(false);
    expect(await processRow(beta.process_id)).toMatchObject({ status: "pending_review", is_sample: false, added_in_demo: false });
    const live = await submitProposal(LIVE, `visitor-d-${run}@example.test`);
    expect(live.auto_approved).toBe(false);
    expect((await processRow(live.process_id))?.status).toBe("pending_review");
  });
});

describe("removal counts everything it deletes (R46)", () => {
  it("counts project comments, reactions, official responses and visitors' items, then deletes them", async () => {
    const admin = await mintSession(DEMO, ADMIN);
    const visitor = ((await localRest(`users?select=id&hub_id=eq.${DEMO}&email=eq.${VISITOR}`)) as Row[])[0].id;
    await localRest("project_comments", {
      method: "POST",
      body: JSON.stringify({ id: `pc_${run}`, hub_id: DEMO, project_id: pid(DEMO, "project_trail_map"), user_id: visitor, content: "Count me in" }),
    });
    await localRest("deliberation_votes", {
      method: "POST",
      body: JSON.stringify({ hub_id: DEMO, process_id: pid(DEMO, "deliberation_rentals"), user_id: visitor, statement_id: 1 }),
    });

    const before = await call("GET", "/admin/hub/sample-content", host(DEMO), undefined, admin);
    expect(before.status).toBe(200);
    expect(before.body.processes).toBeGreaterThanOrEqual(11);
    expect(before.body.added_in_demo).toBe(2); // the published proposal and the one in review
    expect(before.body.real_input.comment).toBeGreaterThanOrEqual(1);
    expect(before.body.real_input.reaction).toBe(1);

    const code = String(100000 + Math.floor(Math.random() * 899999));
    await localRest("pending_verifications", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ hub_id: DEMO, email: ADMIN, code, expires_at: new Date(Date.now() + 600_000).toISOString(), attempts: 0 }),
    });
    const res = await call("POST", "/admin/hub/sample-content/remove", host(DEMO), { code }, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Everything, the visitors' items and their reviews included.
    expect((await localRest(`processes?select=id&hub_id=eq.${DEMO}`)) as Row[]).toHaveLength(0);
    expect((await localRest(`process_reviews?select=id&hub_id=eq.${DEMO}`)) as Row[]).toHaveLength(0);
    expect((await localRest(`review_turns?select=id&hub_id=eq.${DEMO}`)) as Row[]).toHaveLength(0);
    expect((await localRest(`project_comments?select=id&hub_id=eq.${DEMO}`)) as Row[]).toHaveLength(0);
    expect((await localRest(`events?select=id&hub_id=eq.${DEMO}`)) as Row[]).toHaveLength(0);
    // The visitor's own account stays.
    expect((await localRest(`users?select=id&id=eq.${visitor}`)) as Row[]).toHaveLength(1);
  });

  it("leaves a real review's turns append-only", async () => {
    const [turn] = (await localRest(`review_turns?select=id&hub_id=eq.${BETA}&limit=1`)) as Row[];
    expect(turn?.id).toBeTruthy();
    await expect(localRest(`review_turns?id=eq.${turn.id}`, { method: "DELETE" })).rejects.toThrow(/append-only/);
  });
});
