// Ballot tags (districts and demographics, 2026-11-16; 20261116040000): a
// ballot carries the voter's district and age group at cast time, and race
// only on a hub that asks; never a person or a time. A change refreshes them;
// reshuffle_ballots keeps them. LOCAL ONLY (reads the stack's Postgres).
// Needs a server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { call } from "../fixtures/hostCall.js";
import { mintSession } from "../fixtures/adminSession.js";
import { createHub } from "../fixtures/operator.js";
import { ageBracket } from "../../src/shared/aboutYou.js";

const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
{
  const host = new URL(DB_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`ballotTags: refusing ${host}; local stack only.`);
}

const run = Date.now().toString(36);
const HUB = `tags-${run}`;
const HOST = `${HUB}.localhost`;
const ADMIN = `tags-admin-${run}@example.test`;
const DISTRICTS = [
  { id: "courthouse", name: "Courthouse" },
  { id: "little-river", name: "Little River" },
];

let db: pg.Client;
let admin = "";
let voteId = "";

interface Ballot {
  receipt_id: string;
  choice: string;
  district_id: string | null;
  age_bracket: string | null;
  race: string[] | null;
}

async function ballots(): Promise<Ballot[]> {
  return (
    await db.query<Ballot>(
      "select receipt_id, choice, district_id, age_bracket, race from vote_records where hub_id = $1 and process_id = $2 order by receipt_id",
      [HUB, voteId],
    )
  ).rows;
}

async function vote(token: string, option: string, receipt: { receipt_id: string; change_key: string } | null = null) {
  const res = await call(
    "POST",
    `/process/${voteId}/action`,
    HOST,
    { type: "process.vote", payload: receipt ? { option, receipt } : { option } },
    token,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result as { receipt_id: string; change_key: string };
}

beforeAll(async () => {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const res = await createHub({ slug: HUB, name: `Tags ${run}`, hostname: HOST, admin_email: ADMIN, hub_kind: "organization", mode: "beta" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  admin = await mintSession(HUB, ADMIN);
  const saved = await call("PUT", "/admin/hub/settings", HOST, { section: "districts", values: { "about.districts": DISTRICTS } }, admin);
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const created = await call(
    "POST",
    "/process",
    HOST,
    {
      definition: { type: "civic.vote", version: "0.1" },
      title: `Ballot tags ${run}`,
      description: "Ballot tags test.",
      state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
    },
    admin,
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  voteId = created.body.id;
  const act = await call("POST", `/process/${voteId}/action`, HOST, { type: "process.activate", payload: {} }, admin);
  expect(act.status, JSON.stringify(act.body)).toBe(200);
});

afterAll(async () => {
  await db?.end();
});

describe("a ballot's tags", () => {
  let held: { receipt_id: string; change_key: string };
  let answered = "";

  it("carry the voter's district and age group, never the year", async () => {
    answered = await mintSession(HUB, `tags-a-${run}@example.test`);
    const saved = await call("PUT", "/user/about", HOST, { district_id: "little-river", birth_year: 1980, race: null }, answered);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    held = await vote(answered, "Yes");
    const mine = (await ballots()).find((b) => b.receipt_id === held.receipt_id)!;
    expect(mine).toMatchObject({ choice: "Yes", district_id: "little-river", age_bracket: ageBracket(1980), race: null });
  });

  it("are empty for a voter who gave nothing", async () => {
    const quiet = await mintSession(HUB, `tags-b-${run}@example.test`);
    const r = await vote(quiet, "No");
    const theirs = (await ballots()).find((b) => b.receipt_id === r.receipt_id)!;
    expect(theirs).toMatchObject({ district_id: null, age_bracket: null, race: null });
  });

  it("follow the voter's answers when they change their vote", async () => {
    await call("PUT", "/user/about", HOST, { district_id: "courthouse" }, answered);
    await vote(answered, "No", held);
    const mine = (await ballots()).find((b) => b.receipt_id === held.receipt_id)!;
    expect(mine).toMatchObject({ choice: "No", district_id: "courthouse" });
  });

  it("survive the reshuffle", async () => {
    const before = await ballots();
    await db.query("select public.reshuffle_ballots($1, $2)", [HUB, voteId]);
    expect(await ballots()).toEqual(before);
  });

  it("include race only where the hub asks", async () => {
    await call("PUT", "/admin/hub/settings", HOST, { section: "districts", values: { "about.ask_race": "true" } }, admin);
    const c = await mintSession(HUB, `tags-c-${run}@example.test`);
    await call("PUT", "/user/about", HOST, { race: ["asian", "white"] }, c);
    const r = await vote(c, "Yes");
    const theirs = (await ballots()).find((b) => b.receipt_id === r.receipt_id)!;
    expect(theirs.race).toEqual(["asian", "white"]);
    await call("PUT", "/admin/hub/settings", HOST, { section: "districts", values: { "about.ask_race": "false" } }, admin);
  });
});
