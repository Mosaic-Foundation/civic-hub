// Audit 3, part one (A7): two people, or two page loads, acting at the same
// moment cannot produce a wrong result.
//
//   - a vote past its deadline, read by many pages at once (and closed by an
//     admin at the same time), closes once: one close event, one
//     result_published, one brief;
//   - a ballot after the deadline, or on a vote that is not open, is refused,
//     by the app and by cast_ballot under its lock;
//   - endorsements made at the same moment all count, and the threshold opens
//     the vote exactly once;
//   - ballots cast at the same moment are all counted (total_votes);
//   - transition_process refuses a stale status or version and writes
//     nothing, events included; every update bumps the version;
//   - a source process cannot have two briefs (unique index).
//
// LOCAL ONLY: the Postgres URL defaults to the stack's fixed local one and
// anything else is refused. Needs a server (CIVIC_API_BASE). Both CI passes.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";

const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
{
  const host = new URL(DB_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`auditConcurrency: refusing ${host}; local stack only.`);
}

const FLOYD = "floyd.civic.social";
const tag = Date.now().toString(36);
const OPTIONS = ["Yes", "No", "Unsure"];

let db: pg.Client;
let admin = "";
const residents: string[] = [];

async function residentTokens(n: number): Promise<string[]> {
  while (residents.length < n) {
    residents.push(await mintSession("floyd", `concurrency-${tag}-${residents.length}@example.test`));
  }
  return residents.slice(0, n);
}

async function createVote(title: string, state: Record<string, unknown>): Promise<string> {
  const created = await call(
    "POST",
    "/process",
    FLOYD,
    {
      definition: { type: "civic.vote", version: "0.1" },
      title: `${title} ${tag}`,
      description: "Concurrency test.",
      state: { options: OPTIONS, voting_duration_ms: 86_400_000, ...state },
    },
    admin,
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.id as string;
}

const act = (id: string, type: string, token: string, payload: Record<string, unknown> = {}) =>
  call("POST", `/process/${id}/action`, FLOYD, { type, payload }, token);

async function eventCounts(processId: string): Promise<Record<string, number>> {
  const { rows } = await db.query<{ event_type: string; n: string }>(
    "SELECT event_type, count(*) AS n FROM events WHERE process_id = $1 GROUP BY event_type",
    [processId],
  );
  return Object.fromEntries(rows.map((r) => [r.event_type, Number(r.n)]));
}

async function processRow(id: string): Promise<{ status: string; state: Record<string, any>; version: number }> {
  const { rows } = await db.query("SELECT status, state, version FROM processes WHERE id = $1", [id]);
  return { ...rows[0], version: Number(rows[0].version) };
}

/** Put a vote's deadline in the past without closing it (what a deadline that passed looks like). */
async function expire(id: string): Promise<void> {
  await db.query(
    `UPDATE processes SET state = jsonb_set(state, '{voting_closes_at}', to_jsonb($2::text)) WHERE id = $1`,
    [id, new Date(Date.now() - 60_000).toISOString()],
  );
}

beforeAll(async () => {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  admin = await mintSession("floyd", "admin@example.test");
});

afterAll(async () => {
  await db?.query("DELETE FROM processes WHERE id LIKE $1", [`proc_conc_b%_${tag}`]);
  await db?.end();
});

describe("a vote past its deadline closes once", () => {
  it("many page loads at once, the hourly job and an admin's close: one close, one result, one brief", async () => {
    const id = await createVote("Close once", { activation_mode: "direct" });
    expect((await act(id, "process.activate", admin)).status).toBe(200);
    const voters = await residentTokens(3);
    for (const [i, t] of voters.entries()) {
      const res = await act(id, "process.vote", t, { option: OPTIONS[i % 3] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    await expire(id);

    // Twelve readers, the list, and an admin's own close, all at once.
    const reads = await Promise.all([
      ...Array.from({ length: 12 }, () => call("GET", `/process/${id}/state`, FLOYD)),
      call("GET", "/process?type=civic.vote", FLOYD),
      call("GET", "/process?type=civic.vote", FLOYD),
      act(id, "process.close", admin),
    ]);
    for (const r of reads.slice(0, 14)) expect(r.status).toBe(200);

    const row = await processRow(id);
    expect(row.status).toBe("finalized");
    expect(row.state.result?.total_votes).toBe(3);

    const counts = await eventCounts(id);
    expect(counts["civic.process.ended"]).toBe(1);
    expect(counts["civic.process.aggregation_completed"]).toBe(1);
    expect(counts["civic.process.result_published"]).toBe(1);
    // One status event for the close (active → finalized); the activate's is the other.
    const { rows: updates } = await db.query(
      "SELECT data FROM events WHERE process_id = $1 AND event_type = 'civic.process.updated'",
      [id],
    );
    expect(updates.filter((u) => u.data?.process?.previous_status === "active")).toHaveLength(1);

    const briefs = (await localRest(
      `processes?select=id&hub_id=eq.floyd&type=eq.civic.brief&state->>source_process_id=eq.${id}`,
    )) as unknown[];
    expect(briefs).toHaveLength(1);

    // A later read changes nothing.
    await call("GET", `/process/${id}/state`, FLOYD);
    expect(await eventCounts(id)).toEqual(counts);
  });

  it("two admins closing an open vote at once: one wins, the other is refused, one set of events", async () => {
    const id = await createVote("Manual close", { activation_mode: "direct" });
    expect((await act(id, "process.activate", admin)).status).toBe(200);
    const results = await Promise.all([act(id, "process.close", admin), act(id, "process.close", admin)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const counts = await eventCounts(id);
    expect(counts["civic.process.result_published"]).toBe(1);
    expect(counts["civic.process.ended"]).toBe(1);
  });
});

describe("a ballot is refused once the vote is not open", () => {
  it("after the deadline, through the app", async () => {
    const id = await createVote("Late ballot", { activation_mode: "direct" });
    expect((await act(id, "process.activate", admin)).status).toBe(200);
    await expire(id);
    const [t] = await residentTokens(1);
    const res = await act(id, "process.vote", t, { option: "Yes" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("vote_closed");
    const { rows } = await db.query("SELECT count(*)::int AS n FROM vote_records WHERE process_id = $1", [id]);
    expect(rows[0].n).toBe(0);
  });

  it("cast_ballot itself refuses past the deadline and on a closed vote, writing nothing", async () => {
    const id = await createVote("Late ballot rpc", { activation_mode: "direct" });
    expect((await act(id, "process.activate", admin)).status).toBe(200);
    const userId = `user_conc_${tag}`;
    const cast = () =>
      db.query("SELECT cast_ballot('floyd', $1, $2, 'Yes', NULL, NULL, NULL, $3)", [id, userId, "a".repeat(64)]);

    await expire(id);
    await expect(cast()).rejects.toThrow(/vote_not_open/);

    await db.query(
      `UPDATE processes SET status = 'closed', state = jsonb_set(state, '{voting_closes_at}', to_jsonb($2::text)) WHERE id = $1`,
      [id, new Date(Date.now() + 86_400_000).toISOString()],
    );
    await expect(cast()).rejects.toThrow(/vote_not_open/);

    const { rows } = await db.query(
      "SELECT (SELECT count(*) FROM vote_records WHERE process_id = $1)::int AS ballots, (SELECT count(*) FROM vote_participation WHERE process_id = $1)::int AS voters",
      [id],
    );
    expect(rows[0]).toEqual({ ballots: 0, voters: 0 });
  });

  it("ballots cast at the same moment are all counted", async () => {
    const id = await createVote("Many ballots", { activation_mode: "direct" });
    expect((await act(id, "process.activate", admin)).status).toBe(200);
    const voters = await residentTokens(10);
    const results = await Promise.all(voters.map((t, i) => act(id, "process.vote", t, { option: OPTIONS[i % 3] })));
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = await processRow(id);
    expect(row.state.total_votes).toBe(10);
    const { rows } = await db.query("SELECT count(*)::int AS n FROM vote_records WHERE process_id = $1", [id]);
    expect(rows[0].n).toBe(10);
  });
});

describe("endorsements at the same moment all count", () => {
  it("below the threshold: every endorsement is recorded", async () => {
    const id = await createVote("Endorse many", { activation_mode: "proposal_required", support_threshold: 50 });
    expect((await act(id, "process.propose", admin)).status).toBe(200);
    const people = await residentTokens(10);
    const results = await Promise.all(people.map((t) => act(id, "process.support", t)));
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = await processRow(id);
    expect(row.status).toBe("proposed");
    expect(row.state.support_count).toBe(10);
    expect(Object.keys(row.state.supporters)).toHaveLength(10);
  });

  it("crossing the threshold together: the vote opens exactly once", async () => {
    const id = await createVote("Endorse threshold", { activation_mode: "proposal_required", support_threshold: 6 });
    expect((await act(id, "process.propose", admin)).status).toBe(200);
    const people = await residentTokens(6);
    const results = await Promise.all(people.map((t) => act(id, "process.support", t)));
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = await processRow(id);
    expect(row.status).toBe("active");
    expect(row.state.support_count).toBe(6);
    const counts = await eventCounts(id);
    expect(counts["civic.process.threshold_met"]).toBe(1);
    expect(counts["civic.process.started"]).toBe(1);
  });

  it("an endorsement and its withdrawal race cleanly", async () => {
    const id = await createVote("Endorse unsupport", { activation_mode: "proposal_required", support_threshold: 50 });
    expect((await act(id, "process.propose", admin)).status).toBe(200);
    const people = await residentTokens(8);
    for (const t of people.slice(0, 4)) expect((await act(id, "process.support", t)).status).toBe(200);
    // Four withdraw while four more endorse.
    const results = await Promise.all([
      ...people.slice(0, 4).map((t) => act(id, "process.unsupport", t)),
      ...people.slice(4, 8).map((t) => act(id, "process.support", t)),
    ]);
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = await processRow(id);
    expect(row.state.support_count).toBe(4);
    expect(Object.keys(row.state.supporters)).toHaveLength(4);
  });
});

describe("transition_process and the version", () => {
  it("every update bumps the version; a stale status or version is refused and writes nothing", async () => {
    const id = await createVote("Transition", { activation_mode: "direct" });
    const before = await processRow(id);
    await db.query("UPDATE processes SET description = description WHERE id = $1", [id]);
    const after = await processRow(id);
    expect(after.version).toBe(before.version + 1);

    const event = {
      id: `evt_conc_${tag}`,
      event_type: "civic.process.updated",
      process_id: id,
      actor: "system:test",
      data: {},
      meta: { visibility: "public" },
    };
    await expect(
      db.query("SELECT transition_process('floyd', $1, 'active', NULL, NULL, NULL, 'closed', NULL, $2::jsonb)", [
        id,
        JSON.stringify([event]),
      ]),
    ).rejects.toThrow(/process_changed/);
    await expect(
      db.query("SELECT transition_process('floyd', $1, 'active', NULL, NULL, NULL, NULL, $2, $3::jsonb)", [
        id,
        after.version - 1,
        JSON.stringify([event]),
      ]),
    ).rejects.toThrow(/process_changed/);
    expect((await processRow(id)).status).toBe("draft");
    const { rows } = await db.query("SELECT count(*)::int AS n FROM events WHERE id = $1", [event.id]);
    expect(rows[0].n).toBe(0);

    // The right expectations: written, with the action's event.
    await db.query("SELECT transition_process('floyd', $1, 'active', NULL, NULL, NULL, 'draft', $2, $3::jsonb)", [
      id,
      after.version,
      JSON.stringify([event]),
    ]);
    expect((await processRow(id)).status).toBe("active");
    const written = await db.query("SELECT count(*)::int AS n FROM events WHERE id = $1", [event.id]);
    expect(written.rows[0].n).toBe(1);
  });
});

describe("one brief per source process", () => {
  it("a second brief for the same source is refused by the database", async () => {
    const source = `proc_conc_src_${tag}`;
    // Archived, so no list or feed ever serves these bare rows; removed after.
    const state = JSON.stringify({ source_process_id: source, content: { title: "Brief", headline: "", sections: [] } });
    const insert = (id: string, hub = "floyd") =>
      db.query(
        `INSERT INTO processes (id, type, process_version, title, status, state, hub_id)
         VALUES ($1, 'civic.brief', '0.1', 'Brief', 'archived', $2::jsonb, $3)`,
        [id, state, hub],
      );
    await insert(`proc_conc_b1_${tag}`);
    await expect(insert(`proc_conc_b2_${tag}`)).rejects.toThrow(/processes_one_brief_per_source/);
    // Another hub may have its own brief for a source of that id.
    await expect(insert(`proc_conc_b3_${tag}`, "athens")).resolves.toBeTruthy();
    await db.query("DELETE FROM processes WHERE id LIKE $1", [`proc_conc_b%_${tag}`]);
  });
});
