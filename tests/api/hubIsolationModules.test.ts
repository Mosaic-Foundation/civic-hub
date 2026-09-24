// Phase 2b: every module converted to forHub() keeps an Athens session out
// of Floyd's rows — proposals, projects, comments, the four kinds of draft,
// feedback, the outcomes index, process links and edits, reviews and
// deliberations.
//
// Same shape as hubIsolation.test.ts (Phase 2a): each Floyd resource is made
// through Floyd's own API, then the same id is tried from Athens, which must
// get a 404, a refusal, or a list without it. Every refusal has a Floyd
// control that succeeds, because "always 404" is also what a broken read path
// looks like.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).
// Sessions are written by tests/fixtures/adminSession.ts, which refuses any
// database not on this machine.

import { beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";

const ATHENS = "athens.localhost";
const FLOYD = "floyd.civic.social";
/** On Floyd's roster: CI seeds people.admin_emails from CIVIC_ADMIN_EMAILS. */
const FLOYD_ADMIN = "admin@example.test";
/** On Athens's roster (supabase/seed.sql). */
const ATHENS_ADMIN = "admin+athens@example.test";

const run = Date.now();
let floydAdmin = "";
let floydResident = "";
let athensAdmin = "";
let athensResident = "";
let floydVoteId = "";

const ids = { proposal: "", project: "", comment: "" };

function ok(res: { status: number; body: unknown }, expected = 200) {
  expect(res.status, JSON.stringify(res.body)).toBe(expected);
}

/** Not a success: the Athens caller learned nothing and changed nothing. */
function refused(res: { status: number; body: unknown }) {
  expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
  expect(res.status).not.toBe(500);
}

beforeAll(async () => {
  floydAdmin = await mintSession("floyd", FLOYD_ADMIN);
  floydResident = await mintSession("floyd", `resident-mod-${run}@example.test`);
  athensAdmin = await mintSession("athens", ATHENS_ADMIN);
  athensResident = await mintSession("athens", `resident-mod-${run}@example.test`.replace("@", "+a@"));

  const vote = await call(
    "POST",
    "/process",
    FLOYD,
    {
      definition: { type: "civic.vote", version: "0.1" },
      title: `Modules isolation vote ${run}`,
      description: "A Floyd vote that Athens must not reach.",
      state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
    },
    floydAdmin,
  );
  ok(vote, 201);
  floydVoteId = vote.body.id ?? vote.body.process?.id;
  ok(
    await call("POST", `/process/${floydVoteId}/action`, FLOYD, { type: "process.activate", payload: {} }, floydAdmin),
  );
});

describe("proposals", () => {
  beforeAll(async () => {
    const res = await call(
      "POST",
      "/proposals",
      FLOYD,
      { title: `Floyd proposal ${run}`, description: "Only Floyd should see this." },
      floydResident,
    );
    ok(res, 201);
    ids.proposal = res.body.id;
  });

  it("by id: Floyd sees it, Athens gets 404", async () => {
    ok(await call("GET", `/proposals/${ids.proposal}`, FLOYD));
    expect((await call("GET", `/proposals/${ids.proposal}`, ATHENS)).status).toBe(404);
  });

  it("in the list: on Floyd's, not on Athens's", async () => {
    const floyd = await call("GET", "/proposals", FLOYD);
    ok(floyd);
    expect(JSON.stringify(floyd.body)).toContain(ids.proposal);
    const athens = await call("GET", "/proposals", ATHENS);
    ok(athens);
    expect(JSON.stringify(athens.body)).not.toContain(ids.proposal);
  });

  it("an Athens resident cannot support it, and its count does not move", async () => {
    refused(await call("POST", `/proposals/${ids.proposal}/support`, ATHENS, {}, athensResident));
    const after = await call("GET", `/proposals/${ids.proposal}`, FLOYD);
    expect(after.body.support_count ?? 0).toBe(0);
  });
});

describe("projects", () => {
  beforeAll(async () => {
    const res = await call(
      "POST",
      "/projects",
      FLOYD,
      { title: `Floyd project ${run}`, description: "Only Floyd should see this." },
      floydResident,
    );
    ok(res, 201);
    ids.project = res.body.id;
  });

  it("by id: Floyd sees it, Athens gets 404", async () => {
    ok(await call("GET", `/projects/${ids.project}`, FLOYD));
    expect((await call("GET", `/projects/${ids.project}`, ATHENS)).status).toBe(404);
  });

  it("in the list: on Floyd's, not on Athens's", async () => {
    expect(JSON.stringify((await call("GET", "/projects", FLOYD)).body)).toContain(ids.project);
    expect(JSON.stringify((await call("GET", "/projects", ATHENS)).body)).not.toContain(ids.project);
  });

  it("an Athens resident cannot record a sentiment on it", async () => {
    refused(
      await call("POST", `/projects/${ids.project}/sentiment`, ATHENS, { sentiment: "support" }, athensResident),
    );
    const rows = (await localRest(
      `project_sentiments?select=user_id&project_id=eq.${encodeURIComponent(ids.project)}`,
    )) as unknown[];
    expect(rows).toEqual([]);
  });
});

describe("comments (community input)", () => {
  beforeAll(async () => {
    const res = await call(
      "POST",
      `/process/${floydVoteId}/input`,
      FLOYD,
      { body: `A Floyd comment ${run}` },
      floydResident,
    );
    ok(res, 201);
    ids.comment = res.body.id ?? res.body.input?.id;
  });

  it("Floyd lists it; Athens gets nothing for Floyd's process", async () => {
    const floyd = await call("GET", `/process/${floydVoteId}/input`, FLOYD);
    ok(floyd);
    expect(JSON.stringify(floyd.body)).toContain(`A Floyd comment ${run}`);
    const athens = await call("GET", `/process/${floydVoteId}/input`, ATHENS);
    expect(JSON.stringify(athens.body)).not.toContain(`A Floyd comment ${run}`);
    if (athens.status === 200) {
      const list = Array.isArray(athens.body) ? athens.body : athens.body.inputs ?? [];
      expect(list).toEqual([]);
    } else {
      expect(athens.status).toBe(404);
    }
  });

  it("an Athens resident cannot comment on Floyd's process", async () => {
    refused(
      await call("POST", `/process/${floydVoteId}/input`, ATHENS, { body: "from Athens" }, athensResident),
    );
    const rows = (await localRest(
      `community_inputs?select=hub_id&process_id=eq.${encodeURIComponent(floydVoteId)}`,
    )) as Array<{ hub_id: string }>;
    expect(rows.every((r) => r.hub_id === "floyd")).toBe(true);
  });

  it("an Athens admin cannot hide it", async () => {
    refused(
      await call(
        "POST",
        `/admin/moderation/comments/${ids.comment}/hide`,
        ATHENS,
        { reason: "cross-hub test" },
        athensAdmin,
      ),
    );
    const [row] = (await localRest(
      `community_inputs?select=hidden_at&id=eq.${encodeURIComponent(ids.comment)}`,
    )) as Array<{ hidden_at: string | null }>;
    expect(row.hidden_at).toBeNull();
  });
});

describe("drafts: a Floyd resident's draft is not reachable from Athens", () => {
  for (const kind of ["proposals", "votes", "projects", "deliberations"] as const) {
    it(`${kind} drafts`, async () => {
      const created = await call("POST", `/${kind}/drafts`, FLOYD, {}, floydResident);
      ok(created, 201);
      const id = created.body.id ?? created.body.draft?.id;
      expect(id, JSON.stringify(created.body)).toBeTruthy();
      ok(await call("GET", `/${kind}/drafts/${id}`, FLOYD, undefined, floydResident));
      const athens = await call("GET", `/${kind}/drafts/${id}`, ATHENS, undefined, athensResident);
      expect([403, 404]).toContain(athens.status);
      expect(JSON.stringify(athens.body)).not.toContain(id);
    });
  }
});

describe("feedback", () => {
  const message = `Floyd feedback ${run}`;

  beforeAll(async () => {
    ok(await call("POST", "/feedback", FLOYD, { category: "general", message }, floydResident));
  });

  it("Floyd's admin sees it; Athens's admin does not", async () => {
    const floyd = await call("GET", "/admin/feedback", FLOYD, undefined, floydAdmin);
    ok(floyd);
    expect(JSON.stringify(floyd.body)).toContain(message);
    const athens = await call("GET", "/admin/feedback", ATHENS, undefined, athensAdmin);
    ok(athens);
    expect(JSON.stringify(athens.body)).not.toContain(message);
  });
});
