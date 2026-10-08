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
  sessions: "credentials; a sample user's sessions go with the user (ON DELETE CASCADE)",
  vote_drafts: "a resident's unsubmitted draft; the seed writes none",
  waitlist: "people asking to join",
};

/**
 * Tables whose rows belong to a REVIEW, and the column naming it (2026-10-07).
 * A visitor's submission on a demo hub has a review; its turns are sample
 * content when the review's process is. The database stamps each turn's own
 * is_sample at insert and lets only those be deleted
 * (20261007000000_added_in_demo).
 */
export const REVIEW_CHILD_COLUMNS: Readonly<Record<string, string>> = {
  review_turns: "review_id",
};

export interface SampleIds {
  processIds: ReadonlySet<string>;
  userIds: ReadonlySet<string>;
  /** Reviews of sample processes (process_reviews.id). */
  reviewIds?: ReadonlySet<string>;
}

/**
 * Is this row part of the hub's sample content? `table` is the row's table;
 * `ids` the hub's sample processes and users.
 */
export function isSampleRow(table: string, row: Record<string, unknown>, ids: SampleIds): boolean {
  if ((MARKED_TABLES as readonly string[]).includes(table) && row.is_sample === true) return true;
  if (table === "processes") return ids.processIds.has(String(row.id));
  if (table === "users") return ids.userIds.has(String(row.id));
  const reviewCol = REVIEW_CHILD_COLUMNS[table];
  if (reviewCol) return row[reviewCol] != null && (ids.reviewIds?.has(String(row[reviewCol])) ?? false);
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
 *
 * Every PROCESS_CHILD_COLUMNS table a person writes is here (review R46,
 * 2026-10-07); tests/unit/sampleContent.test.ts checks the rest are written
 * by the hub itself. A review is counted only on a seeded sample (an edit a
 * visitor proposed); a visitor's own submission is counted as the item.
 */
export const PARTICIPATION_TABLES: ReadonlyArray<{
  table: string;
  processColumn: string;
  userColumn: string;
  kind: ParticipationKind;
  /** Count only on the seeded samples, not on visitors' own items. */
  seededOnly?: boolean;
}> = [
  { table: "community_inputs", processColumn: "process_id", userColumn: "author_id", kind: "comment" },
  { table: "project_comments", processColumn: "project_id", userColumn: "user_id", kind: "comment" },
  { table: "proposal_supports", processColumn: "proposal_id", userColumn: "user_id", kind: "endorsement" },
  { table: "project_sentiments", processColumn: "project_id", userColumn: "user_id", kind: "endorsement" },
  { table: "vote_participation", processColumn: "process_id", userColumn: "user_id", kind: "ballot" },
  { table: "deliberation_submissions", processColumn: "process_id", userColumn: "user_id", kind: "statement" },
  { table: "deliberation_votes", processColumn: "process_id", userColumn: "user_id", kind: "reaction" },
  { table: "wordcloud_submissions", processColumn: "process_id", userColumn: "author_id", kind: "submission" },
  { table: "brief_responses", processColumn: "brief_id", userColumn: "responder_id", kind: "response" },
  { table: "process_reviews", processColumn: "process_id", userColumn: "creator_id", kind: "review", seededOnly: true },
];

export type ParticipationKind =
  | "comment"
  | "endorsement"
  | "ballot"
  | "statement"
  | "reaction"
  | "submission"
  | "response"
  | "review";

/**
 * PROCESS_CHILD_COLUMNS tables no person writes: the hub, the seed or the
 * process itself does. With PARTICIPATION_TABLES they cover the whole list.
 */
export const NOT_PARTICIPATION: Readonly<Record<string, string>> = {
  active_vote_keys: "a voter's key while a vote is open; their ballot is counted through vote_participation",
  events: "the log of the actions counted here",
  process_links: "links between processes",
  project_updates: "written by the project's own author",
  projects: "the process's own row",
  proposals: "the process's own row",
  vote_records: "anonymous ballots; counted through vote_participation",
};

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
