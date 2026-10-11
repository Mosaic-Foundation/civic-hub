// The ballot-secrecy schema rules fail on each change they exist to stop
// (tests/fixtures/ballotSecrecyRules.ts; the real schema is checked by
// tests/api/ballotSecrecyCatalog.test.ts). And static guards on the code: no
// receipt in a logged URL, no lookup of a voter's ballot by identity.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ballotSecrecyProblems,
  type CheckRow,
  type ColumnRow,
  type FunctionRow,
} from "../fixtures/ballotSecrecyRules.js";

const col = (table: string, column: string, data_type = "text", def: string | null = null): ColumnRow => ({
  table,
  column,
  data_type,
  default: def,
});

const GOOD_COLUMNS: ColumnRow[] = [
  col("vote_records", "receipt_id"),
  col("vote_records", "process_id"),
  col("vote_records", "choice"),
  col("vote_records", "hub_id"),
  col("vote_records", "change_key_hash"),
  col("vote_records", "created_at", "timestamp with time zone"),
  col("vote_participation", "user_id"),
  col("vote_participation", "process_id"),
  col("vote_participation", "created_at", "timestamp with time zone", "now()"),
  col("active_vote_keys", "receipt_id"),
];
const GOOD_CHECKS: CheckRow[] = [{ table: "vote_records", name: "vote_records_no_time", definition: "CHECK ((created_at IS NULL))" }];
const GOOD_FUNCTIONS: FunctionRow[] = [
  { name: "cast_ballot", source: "INSERT INTO vote_participation ...; INSERT INTO vote_records ..." },
  { name: "cast_vote", source: "INSERT INTO active_vote_keys (user_id, process_id, receipt_id, hub_id)" },
  { name: "claim_vote_key", source: "DELETE FROM active_vote_keys WHERE ..." },
];

const check = (over: { columns?: ColumnRow[]; checks?: CheckRow[]; functions?: FunctionRow[] }) =>
  ballotSecrecyProblems({
    columns: over.columns ?? GOOD_COLUMNS,
    checks: over.checks ?? GOOD_CHECKS,
    functions: over.functions ?? GOOD_FUNCTIONS,
  });

describe("ballot secrecy schema rules", () => {
  it("the layout as built passes", () => {
    expect(check({})).toEqual([]);
  });

  it("a person beside a ballot fails", () => {
    expect(check({ columns: [...GOOD_COLUMNS, col("vote_records", "user_id")] }).join("\n")).toMatch(/vote_records\.user_id/);
  });

  it("a time on a ballot fails: a clock default, or the NULL check dropped", () => {
    const stamped = GOOD_COLUMNS.map((c) =>
      c.table === "vote_records" && c.column === "created_at" ? { ...c, default: "now()" } : c,
    );
    expect(check({ columns: stamped }).join("\n")).toMatch(/created_at: default now\(\)/);
    expect(check({ checks: [] }).join("\n")).toMatch(/no CHECK forces to NULL/);
    expect(check({ columns: [...GOOD_COLUMNS, col("vote_records", "cast_on", "date")] }).join("\n")).toMatch(/cast_on/);
  });

  it("an ordering column on a ballot fails (a sequence default)", () => {
    expect(
      check({ columns: [...GOOD_COLUMNS, col("vote_records", "seq", "bigint", "nextval('vote_records_seq'::regclass)")] }).join("\n"),
    ).toMatch(/seq/);
  });

  it("a receipt beside a voter fails", () => {
    expect(check({ columns: [...GOOD_COLUMNS, col("vote_participation", "receipt_id")] }).join("\n")).toMatch(
      /vote_participation\.receipt_id/,
    );
    expect(check({ columns: [...GOOD_COLUMNS, col("vote_receipts_by_user", "receipt_id")] }).join("\n")).toMatch(
      /a receipt outside vote_records/,
    );
  });

  it("a new writer of the retired bridge fails, and cast_ballot must not touch it", () => {
    const writer = { name: "remember_voter", source: "INSERT INTO active_vote_keys VALUES (...)" };
    expect(check({ functions: [...GOOD_FUNCTIONS, writer] }).join("\n")).toMatch(/remember_voter/);
    const bad = GOOD_FUNCTIONS.map((f) =>
      f.name === "cast_ballot" ? { ...f, source: f.source + "; INSERT INTO active_vote_keys ..." } : f,
    );
    expect(check({ functions: bad }).join("\n")).toMatch(/cast_ballot: touches active_vote_keys/);
  });
});

// --- Static guards on the code ------------------------------------------------

const ROOT = join(__dirname, "../..");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const read = (p: string) => readFileSync(p, "utf8");
const rel = (p: string) => p.slice(ROOT.length + 1);

describe("ballot secrecy in the code", () => {
  const server = files(join(ROOT, "src"));
  const ui = files(join(ROOT, "ui/src"));

  it("no server code filters a table by receipt in a URL (receipts travel in an RPC body)", () => {
    const hits = server.filter((p) => /\.eq\(\s*["']receipt_id["']|receipt_id=eq\./.test(read(p))).map(rel);
    expect(hits).toEqual([]);
  });

  it("no server code reads the retired bridge to find a voter's ballot, or calls the legacy cast_vote", () => {
    const hits = server
      .filter((p) => /getActiveChoice|\.from\(\s*["']active_vote_keys["']\s*\)\s*\.select|rpc[^)]*["']cast_vote["']/.test(read(p)))
      .map(rel);
    expect(hits).toEqual([]);
  });

  it("no UI link or request puts a receipt in a query string", () => {
    const hits = ui.filter((p) => /[?&]receipt=/.test(read(p))).map(rel);
    expect(hits).toEqual([]);
  });

  it("the vote's log line names no voter", () => {
    expect(read(join(ROOT, "src/db/atomic.ts"))).toMatch(/vote_submitted" \? "a voter"/);
  });
});
