// Phase 2b: the controllers and services converted to forHub() keep an
// Athens session out of Floyd's reviews, word clouds, conversations,
// outcomes, process links and edits, and out of Floyd's admin queue counts.
//
// Same shape as hubIsolation.test.ts: each Floyd resource is made through
// Floyd's own API (the one published brief is written straight into the
// local stack, since publishing one takes a closed vote and two admin
// steps), then tried from Athens, with a Floyd control that succeeds.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";

const ATHENS = "athens.localhost";
const FLOYD = "floyd.civic.social";
const FLOYD_ADMIN = "admin@example.test";
const ATHENS_ADMIN = "admin+athens@example.test";

const run = Date.now();
let floydAdmin = "";
let floydResident = "";
let athensAdmin = "";
let athensResident = "";
let voteId = "";
let wordcloudId = "";
let reviewId = "";
const briefId = `proc_brief_iso_${run}`;

function ok(res: { status: number; body: unknown }, expected = 200) {
  expect(res.status, JSON.stringify(res.body)).toBe(expected);
}

function refused(res: { status: number; body: unknown }) {
  expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
  expect(res.status).not.toBe(500);
}

async function createProcess(type: string, title: string, state: Record<string, unknown>) {
  const res = await call(
    "POST",
    "/process",
    FLOYD,
    { definition: { type, version: "0.1" }, title, description: "Floyd only.", state },
    floydAdmin,
  );
  ok(res, 201);
  const id = res.body.id ?? res.body.process?.id;
  ok(await call("POST", `/process/${id}/action`, FLOYD, { type: "process.activate", payload: {} }, floydAdmin));
  return id as string;
}

beforeAll(async () => {
  floydAdmin = await mintSession("floyd", FLOYD_ADMIN);
  floydResident = await mintSession("floyd", `resident-ctl-${run}@example.test`);
  athensAdmin = await mintSession("athens", ATHENS_ADMIN);
  athensResident = await mintSession("athens", `resident-ctl-${run}+a@example.test`);

  voteId = await createProcess("civic.vote", `Controllers isolation vote ${run}`, {
    options: ["Yes", "No"],
    voting_duration_ms: 86_400_000,
    activation_mode: "direct",
  });
  wordcloudId = await createProcess("civic.wordcloud", `Controllers isolation cloud ${run}`, {
    prompts: [{ id: "p1", text: "One word for this place?" }],
  });

  const submitted = await call(
    "POST",
    "/reviews/submit",
    FLOYD,
    {
      process_type: "civic.vote",
      title: `Floyd review ${run}`,
      description: "Waiting for Floyd's admins.",
      state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000 },
    },
    floydResident,
  );
  ok(submitted, 201);
  reviewId = submitted.body.review?.id ?? submitted.body.review_id ?? submitted.body.id;
  expect(reviewId, JSON.stringify(submitted.body)).toBeTruthy();

  await localRest("processes", {
    method: "POST",
    body: JSON.stringify({
      id: briefId,
      hub_id: "floyd",
      type: "civic.brief",
      title: `Floyd outcome ${run}`,
      status: "finalized",
      state: {
        publication_status: "published",
        published_at: new Date().toISOString(),
        source_process_id: voteId,
        source_process_type: "civic.vote",
        content: { headline: "Floyd decided", participation_label: "3 residents" },
      },
    }),
  });
});

afterAll(async () => {
  await localRest(`processes?id=eq.${briefId}`, { method: "DELETE" });
});

describe("reviews", () => {
  it("the Floyd creator sees their review; an Athens resident gets nothing", async () => {
    ok(await call("GET", `/reviews/${reviewId}`, FLOYD, undefined, floydResident));
    const athens = await call("GET", `/reviews/${reviewId}`, ATHENS, undefined, athensResident);
    expect([403, 404]).toContain(athens.status);
  });

  it("Floyd's admin sees it; Athens's admin can neither see nor approve it", async () => {
    ok(await call("GET", `/admin/reviews/${reviewId}`, FLOYD, undefined, floydAdmin));
    expect((await call("GET", `/admin/reviews/${reviewId}`, ATHENS, undefined, athensAdmin)).status).toBe(404);
    refused(await call("POST", `/admin/reviews/${reviewId}/approve`, ATHENS, {}, athensAdmin));
    const [row] = (await localRest(
      `process_reviews?select=status&id=eq.${encodeURIComponent(reviewId)}`,
    )) as Array<{ status: string }>;
    expect(row.status).toBe("pending_review");
  });

  it("the review queue: on Floyd's list, not on Athens's", async () => {
    expect(JSON.stringify((await call("GET", "/admin/reviews", FLOYD, undefined, floydAdmin)).body)).toContain(reviewId);
    const athens = await call("GET", "/admin/reviews", ATHENS, undefined, athensAdmin);
    ok(athens);
    expect(JSON.stringify(athens.body)).not.toContain(reviewId);
  });
});

describe("word clouds", () => {
  it("Floyd serves it; Athens gets 404 for the cloud and its responses", async () => {
    ok(await call("GET", `/wordcloud/${wordcloudId}`, FLOYD));
    expect((await call("GET", `/wordcloud/${wordcloudId}`, ATHENS)).status).toBe(404);
    expect((await call("GET", `/wordcloud/${wordcloudId}/cloud`, ATHENS)).status).toBe(404);
  });

  it("an Athens resident cannot submit to it", async () => {
    refused(
      await call(
        "POST",
        `/process/${wordcloudId}/action`,
        ATHENS,
        { type: "process.submit", payload: { prompt_id: "p1", body: "athens" } },
        athensResident,
      ),
    );
    const rows = (await localRest(
      `wordcloud_submissions?select=hub_id&process_id=eq.${encodeURIComponent(wordcloudId)}`,
    )) as unknown[];
    expect(rows).toEqual([]);
  });
});

describe("conversations (deliberations)", () => {
  it("each hub lists only its own", async () => {
    const floyd = await call("GET", "/deliberations", FLOYD);
    const athens = await call("GET", "/deliberations", ATHENS);
    ok(floyd);
    ok(athens);
    const ids = (body: any) =>
      ((Array.isArray(body) ? body : body.deliberations ?? body.processes ?? []) as Array<{ id: string }>).map(
        (d) => d.id,
      );
    const floydIds = ids(floyd.body);
    expect(floydIds.length).toBeGreaterThan(0);
    for (const id of floydIds) expect(ids(athens.body)).not.toContain(id);
    expect((await call("GET", `/deliberations/${floydIds[0]}`, ATHENS)).status).toBe(404);
    ok(await call("GET", `/deliberations/${floydIds[0]}`, FLOYD));
  });
});

describe("outcomes (published briefs)", () => {
  it("on Floyd's index, not on Athens's; Athens gets 404 by id", async () => {
    const floyd = await call("GET", "/brief", FLOYD);
    ok(floyd);
    expect(JSON.stringify(floyd.body)).toContain(briefId);
    const athens = await call("GET", "/brief", ATHENS);
    ok(athens);
    expect(JSON.stringify(athens.body)).not.toContain(briefId);
    expect((await call("GET", `/brief/${briefId}`, ATHENS)).status).toBe(404);
  });
});

describe("process links and edits", () => {
  it("Floyd's links are not readable, creatable or deletable from Athens", async () => {
    const made = await call(
      "POST",
      `/process/${voteId}/links`,
      FLOYD,
      { to_id: wordcloudId, relation: "references" },
      floydAdmin,
    );
    ok(made, 201);
    const floyd = await call("GET", `/process/${voteId}/links`, FLOYD);
    ok(floyd);
    expect(JSON.stringify(floyd.body)).toContain(wordcloudId);

    const athens = await call("GET", `/process/${voteId}/links`, ATHENS);
    expect(JSON.stringify(athens.body)).not.toContain(wordcloudId);

    refused(
      await call("POST", `/process/${voteId}/links`, ATHENS, { to_id: wordcloudId, relation: "references" }, athensAdmin),
    );
    const linkId = made.body.id ?? made.body.link?.id;
    if (linkId) refused(await call("DELETE", `/process/${voteId}/links/${linkId}`, ATHENS, undefined, athensAdmin));
    const rows = (await localRest(
      `process_links?select=hub_id&from_id=eq.${encodeURIComponent(voteId)}`,
    )) as Array<{ hub_id: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].hub_id).toBe("floyd");
  });

  it("edit history of a Floyd process is not readable from Athens", async () => {
    ok(await call("GET", `/process/${voteId}/edits`, FLOYD));
    const athens = await call("GET", `/process/${voteId}/edits`, ATHENS);
    if (athens.status === 200) {
      const list = Array.isArray(athens.body) ? athens.body : athens.body.edits ?? [];
      expect(list).toEqual([]);
    } else {
      expect(athens.status).toBe(404);
    }
  });
});

describe("admin queue counts", () => {
  it("Floyd's pending review counts on Floyd, not on Athens", async () => {
    const floyd = await call("GET", "/admin/queue-counts", FLOYD, undefined, floydAdmin);
    const athens = await call("GET", "/admin/queue-counts", ATHENS, undefined, athensAdmin);
    ok(floyd);
    ok(athens);
    const reviews = (b: any) => Number(b.reviews ?? b.counts?.reviews ?? 0);
    expect(reviews(floyd.body)).toBeGreaterThan(0);
    const athensPending = (await localRest(
      "process_reviews?select=id&hub_id=eq.athens&status=eq.pending_review",
    )) as unknown[];
    expect(reviews(athens.body)).toBeLessThanOrEqual(athensPending.length);
  });
});
