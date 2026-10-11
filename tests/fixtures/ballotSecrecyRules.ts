// The schema rules that keep a voter and their ballot apart in the raw data
// (ballot secrecy, 2026-10-10), as one pure function over rows read from the
// catalog. tests/api/ballotSecrecyCatalog.test.ts runs it on the real schema;
// tests/unit/ballotSecrecyRules.test.ts proves each rule fails on the change
// it exists to stop. A migration that puts a person, a time, or a bridge back
// beside a ballot fails CI here, naming the rule.

export interface ColumnRow {
  table: string;
  column: string;
  data_type: string;
  default: string | null;
}

export interface CheckRow {
  table: string;
  name: string;
  definition: string;
}

export interface FunctionRow {
  name: string;
  source: string;
}

/**
 * Every column a ballot may have. A new one is a design decision: add it
 * here only after asking whether it can tell anyone who cast the ballot or
 * when.
 */
export const BALLOT_COLUMNS: Readonly<Record<string, string>> = {
  receipt_id: "the voter's receipt, random; public in the vote log",
  process_id: "the vote",
  choice: "the ballot",
  hub_id: "tenancy; adds no link (a process has one hub)",
  change_key_hash: "sha256 of the change key only the voter's browser holds",
  created_at: "kept for old readers; ALWAYS NULL (vote_records_no_time)",
};

/** The bridge from before 2026-10-10: may exist until dropped, never written. */
export const RETIRED_BRIDGE = "active_vote_keys";

/**
 * Functions allowed to write the retired bridge: only the legacy cast_vote,
 * kept for the deploy window and dropped with the table. Nothing may be
 * added here.
 */
export const LEGACY_BRIDGE_WRITERS = ["cast_vote"];

const PERSON = /user|actor|voter|email|session|account|ip_?addr|device/i;
const RECEIPT = /receipt/i;
const TIME_TYPE = /timestamp|date|time/i;
const CLOCK_DEFAULT = /now\(|current_timestamp|clock_timestamp|statement_timestamp|transaction_timestamp|localtimestamp|nextval\(/i;

export function ballotSecrecyProblems(input: {
  columns: ColumnRow[];
  checks: CheckRow[];
  functions: FunctionRow[];
}): string[] {
  const problems: string[] = [];
  const ballot = input.columns.filter((c) => c.table === "vote_records");

  if (ballot.length === 0) problems.push("vote_records: not found");

  for (const c of ballot) {
    if (!(c.column in BALLOT_COLUMNS)) {
      problems.push(`vote_records.${c.column}: not an allowed ballot column (tests/fixtures/ballotSecrecyRules.ts)`);
    }
    if (PERSON.test(c.column)) problems.push(`vote_records.${c.column}: names a person beside a ballot`);
    if (c.default && CLOCK_DEFAULT.test(c.default)) {
      problems.push(`vote_records.${c.column}: default ${c.default} stamps when (or in what order) a ballot was cast`);
    }
    if (TIME_TYPE.test(c.data_type)) {
      const forcedNull = input.checks.some(
        (k) => k.table === "vote_records" && new RegExp(`\\(?\\s*${c.column}\\s+IS\\s+NULL\\s*\\)?`, "i").test(k.definition),
      );
      if (!forcedNull) problems.push(`vote_records.${c.column}: a time on a ballot that no CHECK forces to NULL`);
    }
  }

  for (const c of input.columns) {
    if (c.table === "vote_participation" && RECEIPT.test(c.column)) {
      problems.push(`vote_participation.${c.column}: links a voter to a receipt`);
    }
    if (RECEIPT.test(c.column) && c.table !== "vote_records" && c.table !== RETIRED_BRIDGE) {
      problems.push(`${c.table}.${c.column}: a receipt outside vote_records`);
    }
  }

  const writesBridge = new RegExp(`(insert\\s+into|update)\\s+(public\\.)?${RETIRED_BRIDGE}\\b`, "i");
  for (const f of input.functions) {
    if (writesBridge.test(f.source) && !LEGACY_BRIDGE_WRITERS.includes(f.name)) {
      problems.push(`function ${f.name}: writes the retired bridge ${RETIRED_BRIDGE}`);
    }
  }

  const cast = input.functions.find((f) => f.name === "cast_ballot");
  if (!cast) problems.push("function cast_ballot: not found");
  else if (new RegExp(RETIRED_BRIDGE, "i").test(cast.source)) {
    problems.push(`function cast_ballot: touches ${RETIRED_BRIDGE}`);
  }

  return problems;
}
