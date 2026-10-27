// Activity, the participation record (the analytics slice, 2026-10-27; ADR-016).
//
// A fresh hub made through the console, with a hand-counted fixture written
// straight into the local stack (residents, processes of five types, their
// events), then the job run through its cron route and every surface read:
//
//   - the counts match the fixture, counted by hand below, for every type
//     and for the three funder measures, each with its derivation;
//   - the job is idempotent: a second run leaves the same rows;
//   - /analytics answers 404 with Public numbers off and no key, 200 with it
//     on, 200 to a live reporting key with it off (each read logged, the log
//     shown to the admin), 401 to a revoked or unknown key; small numbers
//     read "fewer than 5" below admin and exactly for the admin;
//   - no response names anyone: no account id, address or name of the
//     fixture's residents appears in any body;
//   - a type that exists nowhere in the code, declared only in a plan, is
//     counted by the same functions (the reader names no type);
//   - the functions never read ballots.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { call } from "../fixtures/hostCall.js";
import { mintSession } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession } from "../fixtures/consoleCall.js";
import { buildPlan } from "../../features/analytics/plan.js";
import type { ProcessTypeSummary } from "../../src/plugins/feature.js";

const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
{
  const host = new URL(DB_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`analytics: refusing ${host}; local stack only.`);
}
const CRON = process.env.CIVIC_TEST_CRON_SECRET?.trim() || "ci-only-cron-secret";

const tag = randomBytes(3).toString("hex");
const SLUG = `an-${tag}`;
const HOST = `${SLUG}.localhost`;
const ADMIN = `analytics-admin-${tag}@example.test`;

let db: pg.Client;
let admin = "";
const residents: Array<{ id: string; email: string; name: string }> = [];
const P = {
  project: `proc_an${tag}proj`,
  vote: `proc_an${tag}vote`,
  conversation: `proc_an${tag}conv`,
  briefOfVote: `proc_an${tag}brv`,
  briefOfConversation: `proc_an${tag}brc`,
  meeting: `proc_an${tag}meet`,
};

async function event(type: string, processId: string, actor: string, data: Record<string, unknown> = {}): Promise<void> {
  await db.query(
    `insert into events (id, event_type, process_id, actor, data, hub_id, version) values ($1, $2, $3, $4, $5, $6, '0.1')`,
    [`evt_an${randomBytes(6).toString("hex")}`, type, processId, actor, JSON.stringify(data), SLUG],
  );
}

async function runJob(): Promise<Record<string, any>> {
  const res = await call("GET", `/internal/analytics/run?hub=${SLUG}`, HOST, undefined, undefined, undefined, { Authorization: `Bearer ${CRON}` });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

async function setPublic(on: boolean): Promise<void> {
  const res = await call("PUT", "/admin/hub/settings", HOST, { section: "plugins", values: { "plugin.analytics.public_numbers": on ? "true" : "false" } }, admin);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/** Every resident's id, address and name: none may appear in an answer. */
function identities(): string[] {
  return residents.flatMap((r) => [r.id, r.email, r.name]);
}

function namesNoOne(body: unknown): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  for (const v of identities()) expect(text.includes(v), `an answer names ${v}`).toBe(false);
}

beforeAll(async () => {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const cookie = await mintConsoleSession();
  const made = await consoleCall("POST", "/control/hubs", {
    cookie,
    body: { slug: SLUG, name: `Analytics Test ${tag}`, hostname: HOST, admin_email: ADMIN, hub_kind: "other" },
  });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  admin = await mintSession(SLUG, ADMIN);

  // Six residents.
  for (let i = 1; i <= 6; i++) {
    const r = { id: `user_an${tag}r${i}`, email: `an-${tag}-r${i}@example.test`, name: `Resident${tag}Number${i}` };
    residents.push(r);
    await db.query(`insert into users (id, hub_id, email, email_verified, is_resident, full_name) values ($1, $2, $3, true, true, $4)`, [
      r.id,
      SLUG,
      r.email,
      r.name,
    ]);
  }
  const [r1, r2, r3, r4, r5, r6] = residents.map((r) => r.id);
  const proc = (id: string, type: string, status: string, state: Record<string, unknown> = {}) =>
    db.query(`insert into processes (id, hub_id, type, title, status, state) values ($1, $2, $3, $4, $5, $6)`, [id, SLUG, type, `Analytics ${type}`, status, JSON.stringify(state)]);
  await proc(P.project, "civic.project", "active");
  await proc(P.vote, "civic.vote", "closed");
  await proc(P.conversation, "civic.polis_deliberation", "closed");
  await proc(P.briefOfVote, "civic.brief", "published", { source_process_id: P.vote });
  await proc(P.briefOfConversation, "civic.brief", "published", { source_process_id: P.conversation });
  await proc(P.meeting, "civic.meeting_summary", "published");

  // A project: r1 makes it, r2 and r3 say how they feel (r2 twice), r4 comments.
  await event("civic.project.created", P.project, r1);
  await event("civic.project.sentiment_changed", P.project, r2);
  await event("civic.project.sentiment_changed", P.project, r3);
  await event("civic.project.sentiment_changed", P.project, r2);
  await event("civic.process.comment_added", P.project, r4);
  // A vote: r1 makes it, r2 and r5 vote, it closes, and its brief goes to officials.
  await event("civic.process.created", P.vote, r1);
  await event("civic.process.vote_submitted", P.vote, r2, { vote: { changed: false } });
  await event("civic.process.vote_submitted", P.vote, r5, { vote: { changed: false } });
  await event("civic.process.ended", P.vote, "system:vote-close");
  await event("civic.process.created", P.briefOfVote, "system:brief-spawn", { source_process_id: P.vote });
  await event("civic.process.outcome_recorded", P.briefOfVote, "system:brief", { source_process_id: P.vote, delivered_to_count: 3 });
  // A conversation r6 started; 40 took part in Polis, as its brief records.
  await event("civic.process.created", P.conversation, r6);
  await event("civic.process.ended", P.conversation, "system:vote-close");
  await event("civic.process.aggregation_completed", P.briefOfConversation, "system:brief-spawn", {
    source_process_id: P.conversation,
    participation_count: 40,
  });
  // A public meeting, recorded.
  await event("civic.process.result_published", P.meeting, "system:meeting-summary");
  await runJob();
}, 60_000);

afterAll(async () => {
  // The hub and every row carrying its hub_id go with the run (tests/setup/dropTestHubs.ts).
  await db?.end();
});

describe("the counts, by hand", () => {
  it("totals: six active residents, the new accounts, what was created, closed and produced", async () => {
    const res = await call("GET", "/admin/analytics?period=month", HOST, undefined, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const t = res.body.totals;
    // r1 (project, vote), r2, r3, r4 (comment), r5, r6 (made a conversation).
    expect(t.active_residents).toBe(6);
    const joined = await db.query<{ n: number }>("select count(*)::int as n from users where hub_id = $1 and is_resident and not is_sample", [SLUG]);
    expect(t.new_residents).toBe(joined.rows[0].n);
    expect(t.new_residents).toBeGreaterThanOrEqual(6);
    // Created: the project, the vote, the conversation and the vote's brief (the fixture writes no created event for the
    // other brief or the meeting), plus whatever a new hub starts with (its starter word cloud): the types' sum.
    const created = res.body.by_type.reduce((n: number, r: { processes_created: number }) => n + r.processes_created, 0);
    expect(t.processes_created).toBe(created);
    expect(created - (res.body.by_type.find((r: { type: string }) => r.type === "civic.wordcloud")?.processes_created ?? 0)).toBe(4);
    expect(t.processes_closed).toBe(2);
    // 3 sentiments + 1 comment + 2 ballots + 40 in Polis.
    expect(t.participations).toBe(46);
    // The vote's brief delivered; the meeting published.
    expect(t.outcomes).toBe(2);
    expect(res.body.retention.residents_in_more_than_one_type).toBe(2);
    expect(res.body.suppression.applied).toBe(false);
  });

  it("by type, from each type's declaration alone", async () => {
    const res = await call("GET", "/admin/analytics?period=month", HOST, undefined, admin);
    const row = (type: string) => res.body.by_type.find((r: { type: string }) => r.type === type);
    expect(row("civic.project")).toMatchObject({ processes_created: 1, participations: 4, active_residents: 4 });
    expect(row("civic.vote")).toMatchObject({ processes_created: 1, processes_closed: 1, participations: 2, active_residents: 3 });
    expect(row("civic.polis_deliberation")).toMatchObject({ processes_created: 1, processes_closed: 1, participations: 40, active_residents: 1 });
    expect(row("civic.brief")).toMatchObject({ processes_created: 1, outcomes: 1, active_residents: 0 });
    expect(row("civic.meeting_summary")).toMatchObject({ outcomes: 1 });
  });

  it("the three funder measures match the hand count, each with how it was derived", async () => {
    const res = await call("GET", "/admin/analytics?period=month", HOST, undefined, admin);
    const m = (id: string) => res.body.measures.find((x: { id: string }) => x.id === id);
    // 40 in Polis; one meeting recorded.
    expect(m("met_in_public")).toMatchObject({ residents: { value: 40 }, records: { value: 1 } });
    // r1, r2, r3, r4 on the project; 3 sentiments and a comment.
    expect(m("worked_with_neighbours")).toMatchObject({ residents: { value: 4 }, records: { value: 4 } });
    // One brief delivered; r1 (made the vote), r2 and r5 (voted) behind it.
    expect(m("contacted_an_official")).toMatchObject({ residents: { value: 3 }, records: { value: 1 } });
    for (const x of res.body.measures) {
      expect(x.derivation).toMatch(/Period: \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}\./);
      expect(x.provenance.participation.length + x.provenance.outcome.length).toBeGreaterThan(0);
    }
    expect(m("contacted_an_official").derivation).toContain("civic.process.outcome_recorded");
  });

  it("the CSV carries the same numbers", async () => {
    const res = await call("GET", "/admin/analytics/csv?period=month", HOST, undefined, admin);
    expect(res.status).toBe(200);
    const text = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
    expect(text).toContain("totals,all types,active_residents,6");
    expect(text).toContain("funder measure,Contacted an official,Briefs delivered to officials,1");
    namesNoOne(text);
  });
});

describe("the job", () => {
  it("is idempotent: a second run leaves the same rows", async () => {
    const snapshot = async () =>
      JSON.stringify({
        days: (await db.query("select day, process_type, event_type, events from analytics_daily where hub_id = $1 order by 1, 2, 3", [SLUG])).rows,
        periods: (await db.query("select period_kind, period_start, period_end, measure, value from analytics_period where hub_id = $1 order by 1, 2, 4", [SLUG])).rows,
      });
    const before = await snapshot();
    await runJob();
    expect(await snapshot()).toBe(before);
  });

  it("stores counts only: no account id in either rollup table", async () => {
    const rows = await db.query("select * from analytics_daily where hub_id = $1 union all select null, null, null, measure, value from analytics_period where hub_id = $1", [SLUG]);
    namesNoOne(rows.rows);
  });
});

describe("/analytics", () => {
  it("404 with Public numbers off and no key", async () => {
    await setPublic(false);
    expect((await call("GET", "/analytics", HOST)).status).toBe(404);
    expect((await call("GET", "/analytics", HOST, undefined, admin)).status).toBe(404);
  });

  it("200 with it on: the admin's numbers, small ones hidden, nobody named", async () => {
    await setPublic(true);
    const res = await call("GET", "/analytics?period=month", HOST);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.totals.active_residents).toBe(6);
    expect(res.body.totals.participations).toBe(46);
    expect(res.body.measures.find((x: { id: string }) => x.id === "worked_with_neighbours").residents.value).toBe("fewer than 5");
    expect(res.body.retention.residents_in_more_than_one_type).toBe("fewer than 5");
    expect(res.body.suppression).toEqual({ applied: true, below: 5, shown_as: "fewer than 5" });
    expect(res.headers?.["cache-control"] ?? "no-store").toContain("no-store");
    namesNoOne(res.body);
    expect((await call("GET", "/analytics?period=decade", HOST)).status).toBe(400);
    await setPublic(false);
  });

  it("a reporting key reads it with Public numbers off; each read is logged; a revoked key reads nothing", async () => {
    const issued = await call("POST", "/admin/analytics/keys", HOST, { organisation: "Example Foundation", contact: "data@example.test", purpose: "Quarterly report" }, admin);
    expect(issued.status, JSON.stringify(issued.body)).toBe(201);
    const key = issued.body.key as string;
    expect(key).toMatch(/^csr_/);
    const stored = await db.query("select key_hash, key_hint from analytics_report_keys where hub_id = $1 and id = $2", [SLUG, issued.body.id]);
    expect(stored.rows[0].key_hash).not.toContain(key);
    expect(stored.rows[0].key_hint).toBe(key.slice(-4));

    const read = await call("GET", "/analytics?period=quarter", HOST, undefined, undefined, undefined, { Authorization: `Bearer ${key}` });
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body.suppression.applied).toBe(true);
    namesNoOne(read.body);

    const listed = await call("GET", "/admin/analytics/keys", HOST, undefined, admin);
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain(key);
    expect(listed.body.keys[0]).toMatchObject({ organisation: "Example Foundation", revoked_at: null });
    expect(listed.body.reads[0]).toMatchObject({ organisation: "Example Foundation", period_kind: "quarter" });

    // The log is append-only.
    await expect(db.query("delete from analytics_report_reads where hub_id = $1", [SLUG])).rejects.toThrow(/append-only/);

    expect((await call("POST", `/admin/analytics/keys/${issued.body.id}/revoke`, HOST, {}, admin)).status).toBe(200);
    expect((await call("GET", "/analytics", HOST, undefined, undefined, undefined, { Authorization: `Bearer ${key}` })).status).toBe(401);
    expect((await call("GET", "/analytics", HOST, undefined, undefined, undefined, { Authorization: `Bearer csr_${"x".repeat(43)}` })).status).toBe(401);
  });

  it("a key of one hub reads nothing on another", async () => {
    const issued = await call("POST", "/admin/analytics/keys", HOST, { organisation: "Other", contact: "o@example.test", purpose: "x" }, admin);
    const key = issued.body.key as string;
    const elsewhere = await call("GET", "/analytics", "athens.localhost", undefined, undefined, undefined, { Authorization: `Bearer ${key}` });
    expect([401, 404]).toContain(elsewhere.status);
  });

  it("residents and visitors are refused the admin's routes", async () => {
    const resident = await mintSession(SLUG, residents[0].email);
    for (const path of ["/admin/analytics", "/admin/analytics/csv", "/admin/analytics/keys"]) {
      expect((await call("GET", path, HOST)).status).toBe(401);
      expect((await call("GET", path, HOST, undefined, resident)).status).toBe(403);
    }
  });
});

describe("the reader names no type", () => {
  it("a type that exists nowhere in the code is counted from its declaration alone", async () => {
    const fake: ProcessTypeSummary = {
      type: "test.made_up",
      label: "Made-up thing",
      plural: "Made-up things",
      residentCreated: true,
      participation: {
        participation: ["test.made_up.joined"],
        creation: ["test.made_up.begun"],
        closing: [],
        outcome: [],
        measures: { worked_with_neighbours: "participation" },
      },
    };
    const id = `proc_an${tag}fake`;
    await db.query(`insert into processes (id, hub_id, type, title, status) values ($1, $2, 'test.made_up', 'Made up', 'active')`, [id, SLUG]);
    await event("test.made_up.begun", id, residents[0].id);
    await event("test.made_up.joined", id, residents[1].id);
    await event("test.made_up.joined", id, residents[2].id);
    const today = new Date().toISOString().slice(0, 10);
    const rows = await db.query<{ measure: string; value: number }>(
      "select * from event_actor_counts($1, 'UTC', $2::date, $2::date, null, null, $3::jsonb)",
      [SLUG, today, JSON.stringify(buildPlan([fake]))],
    );
    const got = Object.fromEntries(rows.rows.map((r) => [r.measure, r.value]));
    expect(got["active:test.made_up"]).toBe(3);
    expect(got["measure:worked_with_neighbours"]).toBe(3);
    const days = await db.query<{ event_type: string; events: number }>(
      "select event_type, events from event_counts_by_day($1, 'UTC', $2::date, $2::date) where process_type = 'test.made_up' order by 1",
      [SLUG, today],
    );
    expect(days.rows).toEqual([
      { event_type: "test.made_up.begun", events: 1 },
      { event_type: "test.made_up.joined", events: 2 },
    ]);
  });
});

describe("ballots", () => {
  it("the event-log functions never read a ballot, a receipt or a participation row", async () => {
    const defs = await db.query<{ def: string }>(
      "select pg_get_functiondef(p.oid) as def from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('event_counts_by_day', 'event_actor_counts')",
    );
    expect(defs.rows).toHaveLength(2);
    for (const { def } of defs.rows) {
      expect(def).not.toMatch(/vote_records|active_vote_keys|vote_participation|ballot/i);
    }
  });
});
