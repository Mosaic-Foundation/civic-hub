// Ballot secrecy, catalog half (2026-10-10): the real schema meets the rules
// in tests/fixtures/ballotSecrecyRules.ts. Read straight from the local
// stack's Postgres, so it holds whatever the app does: no person and no time
// on a ballot, no receipt beside a voter, nothing new writing the retired
// bridge. A migration that brings a link back fails here, naming it.
//
// LOCAL ONLY (refuses any other database host). Runs in both CI passes.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { ballotSecrecyProblems, type CheckRow, type ColumnRow, type FunctionRow } from "../fixtures/ballotSecrecyRules.js";

const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
{
  const host = new URL(DB_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`ballotSecrecyCatalog: refusing ${host}; local stack only.`);
}

let db: pg.Client;

beforeAll(async () => {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
});

afterAll(async () => {
  await db?.end();
});

describe("ballot secrecy in the schema", () => {
  it("no person, time, order or bridge beside a ballot", async () => {
    const columns = (
      await db.query<ColumnRow>(
        `select table_name as table, column_name as column, data_type, column_default as default
           from information_schema.columns where table_schema = 'public'`,
      )
    ).rows;
    const checks = (
      await db.query<CheckRow>(
        `select c.conrelid::regclass::text as table, c.conname as name, pg_get_constraintdef(c.oid) as definition
           from pg_constraint c join pg_namespace n on n.oid = c.connamespace
          where n.nspname = 'public' and c.contype = 'c'`,
      )
    ).rows;
    const functions = (
      await db.query<FunctionRow>(
        `select p.proname as name, p.prosrc as source
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'`,
      )
    ).rows;
    expect(ballotSecrecyProblems({ columns, checks, functions })).toEqual([]);
  });

  it("the database refuses a ballot with a time", async () => {
    await expect(
      db.query(
        `insert into vote_records (receipt_id, process_id, choice, hub_id, created_at)
         values ('rcpt_catalog_probe', 'proc_catalog_probe', 'Yes', 'floyd', now())`,
      ),
    ).rejects.toThrow(/vote_records_no_time/);
  });
});
