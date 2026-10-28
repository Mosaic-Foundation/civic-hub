// Vote results retire into the brief (engine 2, C; ADR-017): the migration
// turns a civic.vote_results row into a civic.brief at the same id, and a
// second run changes nothing; its published address redirects to the brief,
// which answers. LOCAL ONLY: pg on the local stack.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";

const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
{
  const host = new URL(DB_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`voteResultsRetired: refusing ${host}; local stack only.`);
}
const MIGRATION = readFileSync(join(import.meta.dirname, "../../supabase/migrations/20261028100000_vote_results_into_briefs.sql"), "utf8");
const ID = `proc_vrretired_${randomBytes(4).toString("hex")}`;
const HOST = "athens.localhost";
let db: pg.Client;

beforeAll(async () => {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const state = {
    type: "civic.vote_results",
    source_process_id: "proc_some_vote",
    publication_status: "published",
    generated_at: "2026-08-01T00:00:00.000Z",
    approved_at: "2026-08-02T00:00:00.000Z",
    published_at: "2026-08-02T00:00:00.000Z",
    delivered_to: ["clerk@example.test"],
    content: {
      title: "Should the library open on Sundays?",
      participation_count: 4,
      position_breakdown: [
        { option_id: "yes", option_label: "Yes", count: 3, percentage: 75 },
        { option_id: "no", option_label: "No", count: 1, percentage: 25 },
      ],
      comments: ["Please do."],
      admin_notes: "Sent to the board.",
      vote_context: { description: "A question about Sunday hours.", options: [], starts_at: null, ends_at: null },
    },
  };
  await db.query(`insert into processes (id, hub_id, type, title, status, state) values ($1, 'athens', 'civic.vote_results', $2, 'finalized', $3)`, [
    ID,
    "Should the library open on Sundays?",
    JSON.stringify(state),
  ]);
});

afterAll(async () => {
  await db.query("delete from processes where id = $1", [ID]);
  await db.end();
});

describe("the migration", () => {
  it("makes the record a brief at the same id, in the brief's shape, keeping the old record whole", async () => {
    await db.query(MIGRATION);
    const { rows } = await db.query("select type, status, state from processes where id = $1", [ID]);
    expect(rows[0].type).toBe("civic.brief");
    expect(rows[0].status).toBe("finalized");
    const s = rows[0].state;
    expect(s).toMatchObject({ type: "civic.brief", source_process_id: "proc_some_vote", source_process_type: "civic.vote", publication_status: "published" });
    expect(s.delivered_to).toEqual(["clerk@example.test"]);
    expect(s.content).toMatchObject({
      title: "Should the library open on Sundays?",
      headline: "The community has voted",
      summary: "A question about Sunday hours.",
      sections: [{ heading: "Results", body: "• Yes: 3 (75%)\n• No: 1 (25%)" }],
      participation_label: "4 votes cast",
      participation_count: 4,
      comments: ["Please do."],
      admin_notes: "Sent to the board.",
    });
    expect(s.legacy_vote_results.position_breakdown).toHaveLength(2);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const before = (await db.query("select state, updated_at from processes where id = $1", [ID])).rows[0];
    const res = await db.query(MIGRATION);
    expect(res.rowCount).toBe(0);
    const after = (await db.query("select state, updated_at from processes where id = $1", [ID])).rows[0];
    expect(after).toEqual(before);
  });
});

describe("its published address", () => {
  it("redirects to the brief, which answers", async () => {
    const res = await call("GET", `/vote-results/${ID}`, HOST);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(`../brief/${ID}`);
    const brief = await call("GET", `/brief/${ID}`, HOST);
    expect(brief.status, JSON.stringify(brief.body)).toBe(200);
    expect(brief.body.title).toBe("Should the library open on Sundays?");
  });
});
