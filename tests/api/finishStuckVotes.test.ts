// scripts/finish-stuck-votes.ts (2026-10-07): a vote that closed while the
// Briefs plugin was off was never finished. The script's logic
// (scripts/lib/finishStuckVotes.ts) runs here in-process, in the server's
// mode, against two votes on Athens shaped like production's leftovers:
//   - stuck: `closed`, one ballot, no brief → finished on apply, its result a
//     "Vote results" card stamped at its close time, status written with its
//     process.updated event;
//   - waiting: `closed` with a pending brief → listed, left alone.
// A dry run changes nothing.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, localStack, mintSession } from "../fixtures/adminSession.js";

const ATHENS = "athens.localhost";
const LOCAL_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const LOCAL_PUBLISHABLE_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const run = Date.now();
const CLOSED_AT = "2026-09-30T16:00:00.000Z";

let stuck = "";
let waiting = "";
const cleanup: string[] = [];

function ok(res: { status: number; body: unknown }, status = 200): void {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
}

/** A vote with one ballot, then put in `closed` with no brief, as Briefs-off left it. */
async function closedVote(admin: string, resident: string, title: string): Promise<string> {
  const res = await call(
    "POST",
    "/process",
    ATHENS,
    {
      definition: { type: "civic.vote", version: "0.1" },
      title,
      description: title,
      state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
    },
    admin,
  );
  ok(res, 201);
  const id = (res.body.id ?? res.body.process?.id) as string;
  ok(await call("POST", `/process/${id}/action`, ATHENS, { type: "process.activate", payload: {} }, admin));
  ok(await call("POST", `/process/${id}/action`, ATHENS, { type: "process.vote", payload: { option: "Yes" } }, resident));
  const [row] = (await localRest(`processes?id=eq.${id}&select=state`)) as Array<{ state: Record<string, unknown> }>;
  await localRest(`processes?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "closed", state: { ...row.state, status: "closed", voting_closes_at: CLOSED_AT } }),
  });
  cleanup.push(id);
  return id;
}

async function inProcess() {
  const { url, key } = localStack();
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  if (process.env.CIVIC_EXPECT_HUB_DB_MODE?.trim() === "hub_token") {
    process.env.CIVIC_HUB_MINTED_TOKEN = "true";
    process.env.CIVIC_HUB_SIGNING_KEY ??= LOCAL_JWT_SECRET;
    process.env.SUPABASE_PUBLISHABLE_KEY ??= LOCAL_PUBLISHABLE_KEY;
  } else {
    process.env.CIVIC_HUB_MINTED_TOKEN = "false";
  }
  const { getHubBySlug } = await import("../../src/db/hubs.js");
  const { fetchHubSettings } = await import("../../src/db/hubSettingsStore.js");
  const { runWithHub } = await import("../../src/config/hubContext.js");
  const { finishStuckVotes } = await import("../../scripts/lib/finishStuckVotes.js");
  const hub = (await getHubBySlug("athens"))!;
  const settings = await fetchHubSettings("athens");
  return (apply: boolean) => runWithHub(hub, settings, () => finishStuckVotes({ apply }));
}

beforeAll(async () => {
  const admin = await mintSession("athens", "admin+athens@example.test");
  const resident = await mintSession("athens", `resident+stuck${run}@example.test`);
  stuck = await closedVote(admin, resident, `Stuck vote ${run}`);
  waiting = await closedVote(admin, resident, `Waiting vote ${run}`);
  const briefId = `proc_stuck_brief_${run}`;
  await localRest("processes", {
    method: "POST",
    body: JSON.stringify({
      id: briefId,
      hub_id: "athens",
      type: "civic.brief",
      title: `Waiting vote ${run}`,
      description: "Inserted by tests/api/finishStuckVotes.test.ts.",
      jurisdiction: "us-test-athens",
      status: "active",
      created_by: "user:civic-admin",
      state: { type: "civic.brief", source_process_id: waiting, source_process_type: "civic.vote", publication_status: "pending" },
    }),
  });
  cleanup.push(briefId);
}, 30_000);

afterAll(async () => {
  for (const id of cleanup.reverse()) {
    await localRest(`processes?id=eq.${id}`, { method: "DELETE" }).catch(() => undefined);
  }
});

describe("finish-stuck-votes", () => {
  it("a dry run lists the stuck vote and the one waiting on its brief, and writes nothing", async () => {
    const finish = await inProcess();
    const report = await finish(false);
    expect(report.applied).toBe(false);
    expect(report.stuck.find((v) => v.id === stuck)).toMatchObject({ title: `Stuck vote ${run}`, closed_at: CLOSED_AT });
    expect(report.stuck.map((v) => v.id)).not.toContain(waiting);
    // A closed row whose state disagrees is listed for a human, never forced.
    for (const v of report.skipped) expect(v.reason).toMatch(/the row is closed but its state says/);
    expect(report.waiting_on_brief.map((v) => v.id)).toContain(waiting);
    const [row] = (await localRest(`processes?id=eq.${stuck}&select=status`)) as Array<{ status: string }>;
    expect(row.status).toBe("closed");
  });

  it("--apply finishes the stuck vote as a close does today, and leaves the other alone", async () => {
    const finish = await inProcess();
    const report = await finish(true);
    expect(report.stuck.find((v) => v.id === stuck)?.total_votes).toBe(1);
    expect(report.failed).toEqual([]);

    const [row] = (await localRest(`processes?id=eq.${stuck}&select=status,state`)) as Array<{
      status: string;
      state: { status: string; result?: { total_votes: number; tally: Record<string, number> } };
    }>;
    expect(row.status).toBe("finalized");
    expect(row.state.status).toBe("finalized");
    expect(row.state.result?.tally.Yes).toBe(1);

    const events = (await localRest(
      `events?process_id=eq.${stuck}&event_type=in.(civic.process.result_published,civic.process.updated)&select=event_type,created_at,data&order=created_at.desc`,
    )) as Array<{ event_type: string; created_at: string; data: { results_at_close?: boolean; process?: { status?: string } } }>;
    const result = events.filter((e) => e.event_type === "civic.process.result_published");
    expect(result).toHaveLength(1);
    expect(result[0].data.results_at_close).toBe(true);
    expect(Date.parse(result[0].created_at)).toBe(Date.parse(CLOSED_AT));
    const updated = events.filter((e) => e.event_type === "civic.process.updated" && e.data.process?.status === "finalized");
    expect(updated).toHaveLength(1);
    expect(Date.parse(updated[0].created_at)).toBe(Date.parse(CLOSED_AT));

    const [other] = (await localRest(`processes?id=eq.${waiting}&select=status`)) as Array<{ status: string }>;
    expect(other.status).toBe("closed");

    // It is a "Vote results" card on the feed now.
    const feed = await call("GET", "/feed?limit=200", ATHENS);
    ok(feed);
    expect(JSON.stringify(feed.body)).toContain(stuck);
  });

  it("a second run finds nothing more to do for it", async () => {
    const finish = await inProcess();
    const report = await finish(false);
    expect(report.stuck.map((v) => v.id)).not.toContain(stuck);
  });
});
