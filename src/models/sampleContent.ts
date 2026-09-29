// Sample content — which rows it is made of (Phase 7).
//
// Contract: BUILD-PLAN-multi-tenant.md → "Phase 7 — Sample content for new
// hubs". Three tables carry the marker itself (`is_sample` on processes,
// events and users; the database stamps events and spawned processes). Every
// other row that belongs to sample content belongs to it THROUGH a sample
// process: a ballot, a comment, an endorsement, a project update, a link.
//
// This file is the one place that says which column of which table names a
// process. The export leaves those rows behind (src/control/hubBundle/
// format.ts → isSampleContentRow) and removal deletes them
// (src/services/sampleContent.ts), both from these lists, so the two can never
// disagree about what "all sample content" is. tests/unit/sampleContent.test.ts
// fails when a table with hub_id is in neither list below, so a table added
// later is classified on purpose rather than missed.
//
// Pure: no database, no request.

/** The tables that carry `is_sample` themselves. */
export const MARKED_TABLES = ["processes", "events", "users"] as const;

/**
 * Tables whose rows belong to a process, and the column(s) naming it. A row
 * is sample content when ANY listed column holds a sample process id.
 * (`proposals` and `projects` share their process's id.)
 */
export const PROCESS_CHILD_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  active_vote_keys: ["process_id"],
  brief_responses: ["brief_id"],
  community_inputs: ["process_id"],
  deliberation_submissions: ["process_id"],
  deliberation_votes: ["process_id"],
  events: ["process_id"],
  process_links: ["from_id", "to_id"],
  process_reviews: ["process_id"],
  project_comments: ["project_id"],
  project_sentiments: ["project_id"],
  project_updates: ["project_id"],
  projects: ["id"],
  proposal_supports: ["proposal_id"],
  proposals: ["id"],
  vote_participation: ["process_id"],
  vote_records: ["process_id"],
  wordcloud_submissions: ["process_id"],
};

/**
 * Tables with hub_id whose rows are never sample content, and why. Listing a
 * table here is a decision; the test refuses a table in neither list.
 */
export const NOT_PROCESS_CONTENT: Readonly<Record<string, string>> = {
  deliberation_drafts: "a resident's unsubmitted draft; the seed writes none",
  feedback_submissions: "product feedback to the hub, not about a process",
  hub_admin_audit_log: "the record of admin actions, including the removal itself",
  hub_settings: "configuration",
  job_runs: "the scheduled jobs' run log",
  link_previews: "a cache of other sites' metadata",
  pending_verifications: "sign-in codes",
  project_drafts: "a resident's unsubmitted draft; the seed writes none",
  proposal_drafts: "a resident's unsubmitted draft; the seed writes none",
  review_turns:
    "keyed by review, not process; the seed writes no reviews, and a sample process under review cannot be removed (review_turns is append-only for every role)",
  sessions: "credentials; a sample user's sessions go with the user (ON DELETE CASCADE)",
  vote_drafts: "a resident's unsubmitted draft; the seed writes none",
  waitlist: "people asking to join",
};

export interface SampleIds {
  processIds: ReadonlySet<string>;
  userIds: ReadonlySet<string>;
}

/**
 * Is this row part of the hub's sample content? `table` is the row's table;
 * `ids` the hub's sample processes and users.
 */
export function isSampleRow(table: string, row: Record<string, unknown>, ids: SampleIds): boolean {
  if ((MARKED_TABLES as readonly string[]).includes(table) && row.is_sample === true) return true;
  if (table === "processes") return ids.processIds.has(String(row.id));
  if (table === "users") return ids.userIds.has(String(row.id));
  const cols = PROCESS_CHILD_COLUMNS[table];
  if (!cols) return false;
  return cols.some((c) => row[c] != null && ids.processIds.has(String(row[c])));
}

// --- Real people's input on sample processes --------------------------------

/**
 * Where a real person's participation in a sample process is recorded, with
 * the column naming the person. Removal counts these for its warning: they
 * are deleted with the process. (`vote_records` holds anonymous ballots with
 * no person on them; `vote_participation` is the one row per voter.)
 */
export const PARTICIPATION_TABLES: ReadonlyArray<{
  table: string;
  processColumn: string;
  userColumn: string;
  kind: "comment" | "endorsement" | "ballot" | "statement" | "submission";
}> = [
  { table: "community_inputs", processColumn: "process_id", userColumn: "author_id", kind: "comment" },
  { table: "proposal_supports", processColumn: "proposal_id", userColumn: "user_id", kind: "endorsement" },
  { table: "project_sentiments", processColumn: "project_id", userColumn: "user_id", kind: "endorsement" },
  { table: "vote_participation", processColumn: "process_id", userColumn: "user_id", kind: "ballot" },
  { table: "deliberation_submissions", processColumn: "process_id", userColumn: "user_id", kind: "statement" },
  { table: "wordcloud_submissions", processColumn: "process_id", userColumn: "author_id", kind: "submission" },
];

// --- Synthetic authors ------------------------------------------------------

/**
 * A sample author's id on one hub. Per hub because `users.id` alone is the
 * primary key: a shared id would collide with, or re-home, another hub's row.
 */
export function sampleUserId(hubId: string, n: number): string {
  return `user_sample_${hubId}_${String(n).padStart(3, "0")}`;
}

/** A sample process's id on one hub, from its template key. */
export function sampleProcessId(hubId: string, key: string): string {
  return `proc_sample_${hubId}_${key}`;
}
