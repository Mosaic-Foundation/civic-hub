// Ballot secrecy against the raw data (2026-10-10). THE PROMISE: nobody,
// including Mosaic operators and anyone holding a copy of the database, a
// backup or an export, can tell how a given resident voted.
//
// A run of votes and changes through the app, a voter from before the change
// collecting their key, the refusals, then the vote closes. Then, holding the
// raw data the way an operator or a stolen backup would:
//
//   - no bridge row is left, and nothing written since links a user and a
//     receipt in ANY table (every row of every table in `public` is scanned)
//   - no ballot carries a time, so no time matches a voter's participation
//     row or event
//   - the ballots share no transaction id (xmin) with any participation row
//     or event (the close rewrote them)
//   - physical row order (what pg_dump writes) does not line ballots up with
//     voters
//   - a per-hub export (scripts/export-hub.ts --from-postgres, as the nightly
//     backup runs it) has no line with both a voter and a receipt, no ballot
//     time, and ballots in receipt order
//
// And the app still works: a change with the receipt keeps it; without it,
// refused with a clear message; a wrong key, refused; a double vote,
// refused; the tally is the voters' final choices.
//
// LOCAL ONLY: the Postgres URL defaults to the stack's fixed local one and
// anything else is refused. Needs a server (CIVIC_API_BASE). Both CI passes.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import pg from "pg";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";

const run = promisify(execFile);
const ROOT = join(__dirname, "../..");
const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
{
  const host = new URL(DB_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`ballotSecrecy: refusing ${host}; local stack only.`);
}

const FLOYD = "floyd.civic.social";
const tag = Date.now().toString(36);
const OPTIONS = ["Yes", "No", "Unsure"];
const VOTERS = 10; // 0–8 vote through the app; 9 is the early voter

type Row = Record<string, unknown>;
interface Voter {
  token: string;
  userId: string;
  receipt?: { receipt_id: string; change_key: string };
  choice?: string;
}

let db: pg.Client;
let admin = "";
let voteId = "";
const voters: Voter[] = [];
/** Receipts in the order their ballots were first written. */
const castOrder: string[] = [];

const vote = (v: Voter, option: string, receipt: Voter["receipt"] | null = v.receipt ?? null) =>
  call(
    "POST",
    `/process/${voteId}/action`,
    FLOYD,
    { type: "process.vote", payload: receipt ? { option, receipt } : { option } },
    v.token,
  );

beforeAll(async () => {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();

  admin = await mintSession("floyd", "admin@example.test");
  const created = await call(
    "POST",
    "/process",
    FLOYD,
    {
      definition: { type: "civic.vote", version: "0.1" },
      title: `Ballot secrecy ${tag}`,
      description: "Ballot secrecy test.",
      state: { options: OPTIONS, voting_duration_ms: 86_400_000, activation_mode: "direct" },
    },
    admin,
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  voteId = created.body.id;
  const act = await call("POST", `/process/${voteId}/action`, FLOYD, { type: "process.activate", payload: {} }, admin);
  expect(act.status, JSON.stringify(act.body)).toBe(200);

  for (let i = 0; i < VOTERS; i++) {
    const email = `secrecy-${tag}-${i}@example.test`;
    const token = await mintSession("floyd", email);
    const [u] = (await localRest(`users?select=id&hub_id=eq.floyd&email=eq.${encodeURIComponent(email)}`)) as Array<{ id: string }>;
    voters.push({ token, userId: u.id });
  }
});

afterAll(async () => {
  await db?.end();
});

describe("votes and changes, with the receipt the voter holds", () => {
  it("each first vote returns a receipt and a change key; the server keeps no bridge", async () => {
    for (let i = 0; i < 9; i++) {
      const v = voters[i];
      const option = OPTIONS[i % 3];
      const res = await vote(v, option, null);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const { receipt_id, change_key, vote_updated } = res.body.result;
      expect(typeof receipt_id).toBe("string");
      expect(typeof change_key).toBe("string");
      expect(vote_updated).toBe(false);
      v.receipt = { receipt_id, change_key };
      v.choice = option;
      castOrder.push(receipt_id);
    }
    expect(await localRest(`active_vote_keys?process_id=eq.${voteId}`)).toEqual([]);
  });

  it("a change with the receipt keeps the receipt and moves the tally", async () => {
    for (const i of [0, 1, 2]) {
      const v = voters[i];
      const next = OPTIONS[(i + 1) % 3];
      const res = await vote(v, next);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.result.receipt_id).toBe(v.receipt!.receipt_id);
      expect(res.body.result.vote_updated).toBe(true);
      expect(res.body.result.change_key).toBeUndefined();
      v.choice = next;
    }
  });

  it("a change without the receipt is refused, and says why", async () => {
    const res = await vote(voters[3], "Unsure", null);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("already_voted");
    expect(res.body.error).toMatch(/your vote is counted/i);
    expect(res.body.error).toMatch(/browser where you voted/i);
  });

  it("a wrong change key, or another voter's receipt, is refused", async () => {
    const wrongKey = await vote(voters[4], "Yes", { receipt_id: voters[4].receipt!.receipt_id, change_key: "not-the-key" });
    expect(wrongKey.status).toBe(400);
    expect(wrongKey.body.code).toBe("receipt_not_accepted");
    const theirs = await vote(voters[5], "Yes", { receipt_id: voters[6].receipt!.receipt_id, change_key: voters[5].receipt!.change_key });
    expect(theirs.status).toBe(400);
    expect(theirs.body.code).toBe("receipt_not_accepted");
  });

  it("a voter from before the change collects a key once, and can then change their vote", async () => {
    const early = voters[9];
    // Cast the way the code before 2026-10-10 did: the legacy cast_vote, which
    // writes the bridge.
    const legacy = (await localRest("rpc/cast_vote", {
      method: "POST",
      body: JSON.stringify({ p_hub_id: "floyd", p_process_id: voteId, p_user_id: early.userId, p_choice: "Yes", p_event: null }),
    })) as { receipt_id: string };
    castOrder.push(legacy.receipt_id);
    expect(await localRest(`active_vote_keys?process_id=eq.${voteId}&user_id=eq.${early.userId}`)).toHaveLength(1);

    const claimed = await call("POST", `/votes/${voteId}/claim-receipt`, FLOYD, {}, early.token);
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(200);
    expect(claimed.body).toMatchObject({ receipt_id: legacy.receipt_id, choice: "Yes" });
    expect(await localRest(`active_vote_keys?process_id=eq.${voteId}`)).toEqual([]);

    const again = await call("POST", `/votes/${voteId}/claim-receipt`, FLOYD, {}, early.token);
    expect(again.status).toBe(404);
    expect(again.body.code).toBe("no_receipt_to_claim");

    early.receipt = { receipt_id: claimed.body.receipt_id, change_key: claimed.body.change_key };
    const changed = await vote(early, "No");
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.result.receipt_id).toBe(legacy.receipt_id);
    early.choice = "No";
  });

  it("someone who has not voted collects nothing", async () => {
    const stranger = await mintSession("floyd", `secrecy-${tag}-stranger@example.test`);
    const res = await call("POST", `/votes/${voteId}/claim-receipt`, FLOYD, {}, stranger);
    expect(res.status).toBe(404);
  });

  it("double voting is still refused: one participation row and one ballot per voter", async () => {
    const participation = (await localRest(`vote_participation?process_id=eq.${voteId}&select=user_id`)) as Row[];
    const ballots = (await localRest(`vote_records?process_id=eq.${voteId}&select=receipt_id`)) as Row[];
    expect(participation).toHaveLength(VOTERS);
    expect(ballots).toHaveLength(VOTERS);
  });

  it("the vote closes and the tally is every voter's final choice", async () => {
    const closed = await call("POST", `/process/${voteId}/action`, FLOYD, { type: "process.close", payload: {} }, admin);
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const state = await call("GET", `/process/${voteId}/state`, FLOYD, undefined, admin);
    expect(state.status).toBe(200);
    const expected: Record<string, number> = { Yes: 0, No: 0, Unsure: 0 };
    for (const v of voters) expected[v.choice!] += 1;
    expect(state.body.tally).toEqual(expected);
    expect(state.body.total_votes).toBe(VOTERS);
  });

  it("each receipt verifies to its voter's final choice, the receipt in a POST body", async () => {
    for (const v of voters) {
      const res = await call("POST", `/votes/${voteId}/verify`, FLOYD, { receipt: v.receipt!.receipt_id });
      expect(res.body).toMatchObject({ found: true, receipt_id: v.receipt!.receipt_id, choice: v.choice });
    }
    const old = await call("GET", `/votes/${voteId}/verify?receipt=${voters[0].receipt!.receipt_id}`, FLOYD);
    expect(old.status).toBe(404);
  });
});

describe("holding the raw data, nothing links a voter to a ballot", () => {
  const userIds = () => voters.map((v) => v.userId);
  const receipts = () => voters.map((v) => v.receipt!.receipt_id);

  it("no bridge row, and no row in any table holds both a voter and a receipt", async () => {
    expect((await db.query("select 1 from active_vote_keys where process_id = $1", [voteId])).rowCount).toBe(0);

    const tables = (
      await db.query<{ t: string }>(
        `select quote_ident(table_name) as t from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`,
      )
    ).rows.map((r) => r.t);
    expect(tables.length).toBeGreaterThan(30);
    const offenders: string[] = [];
    for (const t of tables) {
      const { rows } = await db.query<{ line: string }>(
        `select x::text as line from ${t} x where x::text like any($1::text[])`,
        [receipts().map((r) => `%${r}%`)],
      );
      for (const { line } of rows) if (userIds().some((u) => line.includes(u))) offenders.push(`${t}: ${line.slice(0, 200)}`);
    }
    expect(offenders).toEqual([]);
  });

  it("no ballot carries a time; no time in a ballot row matches a voter's participation or event", async () => {
    const ballots = (await db.query("select * from vote_records where process_id = $1", [voteId])).rows as Row[];
    expect(ballots).toHaveLength(VOTERS);
    for (const b of ballots) {
      expect(b.created_at).toBeNull();
      for (const v of Object.values(b)) expect(v instanceof Date).toBe(false);
    }
    // And belt and braces: the voters' participation and event times appear
    // nowhere in the ballot rows' text.
    const times = (
      await db.query<{ t: string }>(
        `select created_at::text as t from vote_participation where process_id = $1
         union select recorded_at::text from events where process_id = $1
         union select created_at::text from events where process_id = $1`,
        [voteId],
      )
    ).rows.map((r) => r.t);
    const text = (await db.query<{ line: string }>("select x::text as line from vote_records x where process_id = $1", [voteId])).rows;
    for (const { line } of text) for (const t of times) expect(line).not.toContain(t);
  });

  it("the ballots share no transaction id with any participation row or event", async () => {
    const xmins = async (sql: string) => new Set((await db.query<{ x: string }>(sql, [voteId])).rows.map((r) => r.x));
    const ballot = await xmins("select xmin::text as x from vote_records where process_id = $1");
    const people = new Set([
      ...(await xmins("select xmin::text as x from vote_participation where process_id = $1")),
      ...(await xmins("select xmin::text as x from events where process_id = $1")),
    ]);
    // One rewrite at close: every ballot has the reshuffle's transaction id.
    expect(ballot.size).toBe(1);
    expect([...ballot].filter((x) => people.has(x))).toEqual([]);
  });

  it("physical row order (what pg_dump writes) does not line ballots up with voters", async () => {
    const heap = (await db.query<{ receipt_id: string }>("select receipt_id from vote_records where process_id = $1 order by ctid", [voteId])).rows.map(
      (r) => r.receipt_id,
    );
    expect([...heap].sort()).toEqual([...castOrder].sort());
    // 10 ballots: the chance a random order equals the cast order is 1 in 10!.
    expect(heap).not.toEqual(castOrder);

    // Pair the n-th participation row with the n-th ballot, as an attacker
    // with a dump would: it must not reproduce who cast what.
    const people = (await db.query<{ user_id: string }>("select user_id from vote_participation where process_id = $1 order by ctid", [voteId])).rows.map(
      (r) => r.user_id,
    );
    const truth = new Map(voters.map((v) => [v.userId, v.receipt!.receipt_id]));
    const right = people.filter((u, n) => truth.get(u) === heap[n]).length;
    expect(right).toBeLessThan(VOTERS);
  });

  it("a per-hub export holds no voter beside a receipt, no ballot time, and ballots in receipt order", async () => {
    const work = await mkdtemp(join(tmpdir(), "civic-secrecy-"));
    const envFile = join(work, "source.env");
    await writeFile(envFile, `CIVIC_SOURCE_DATABASE_URL=${DB_URL}\n`);
    try {
      await run("node", [`--env-file=${envFile}`, "--import", "tsx", "scripts/export-hub.ts", "--hub", "floyd", "--from-postgres", "--no-images", "--out", work], {
        cwd: ROOT,
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      throw new Error(`export-hub failed: ${err.stdout ?? ""}${err.stderr ?? ""}`);
    }
    const name = (await readdir(work)).find((f) => f.startsWith("civic-hub-export-floyd-"))!;
    const tablesDir = join(work, name, "tables");
    const offenders: string[] = [];
    for (const file of await readdir(tablesDir)) {
      const lines = (await readFile(join(tablesDir, file), "utf8")).split("\n").filter(Boolean);
      for (const line of lines) {
        if (receipts().some((r) => line.includes(r)) && userIds().some((u) => line.includes(u))) offenders.push(`${file}: ${line.slice(0, 200)}`);
      }
      if (file === "vote_records.jsonl") {
        const rows = lines.map((l) => JSON.parse(l) as Row);
        const ours = rows.filter((r) => r.process_id === voteId);
        expect(ours).toHaveLength(VOTERS);
        for (const r of rows) expect(r.created_at ?? null).toBeNull();
        const ids = rows.map((r) => String(r.receipt_id));
        expect(ids).toEqual([...ids].sort());
      }
      if (file === "active_vote_keys.jsonl") {
        expect(lines.filter((l) => l.includes(voteId))).toEqual([]);
      }
    }
    expect(offenders).toEqual([]);
  }, 120_000);

  it("the change key is stored only as its hash", async () => {
    const ballots = (await db.query<{ receipt_id: string; change_key_hash: string }>(
      "select receipt_id, change_key_hash from vote_records where process_id = $1",
      [voteId],
    )).rows;
    for (const v of voters) {
      const row = ballots.find((b) => b.receipt_id === v.receipt!.receipt_id)!;
      expect(row.change_key_hash).toBe(createHash("sha256").update(v.receipt!.change_key, "utf8").digest("hex"));
      expect(JSON.stringify(ballots)).not.toContain(v.receipt!.change_key);
    }
  });
});
