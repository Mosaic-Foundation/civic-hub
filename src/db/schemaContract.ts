// Schema contract — what the running code needs the database to look like.
//
// WHY THIS EXISTS
// On 2026-08-22 a commit that inserts `waitlist.wants_test_user` was deployed
// before its migration was applied. Prod ran code against a table without the
// column, so POST /waitlist returned 500 and — because loadSettings() awaits
// getWaitlist() inline — the entire admin settings page went with it. The
// whole time, GET /health returned "ok": the ping only proves the connection
// works, not that the schema matches the code standing on top of it.
//
// A contract turns that silent outage into a line in the deploy log.
//
// WHAT THIS IS NOT
// Not a migration runner, and not a substitute for one. It never writes. It
// reads nothing but table shape. It cannot repair drift — it can only refuse
// to be quiet about it.
//
// PLUGIN ARCHITECTURE
// Process handlers that own storage declare it themselves via the optional
// `requiredSchema` on ProcessHandler, and this module aggregates whatever the
// registry currently holds. A hub that omits civic.wordcloud drops the
// wordcloud_submissions expectation with it — the check follows the plugins
// rather than hardcoding what a hub "should" have. CORE_REQUIREMENTS below
// covers only tables the core owns regardless of which processes are enabled.

import { getAllHandlers } from "../processes/registry.js";

export interface SchemaRequirement {
  /** Table that must exist. */
  table: string;
  /**
   * Columns whose absence breaks a read or write path. Omit to check that the
   * table merely exists.
   *
   * List the drift-prone ones — anything a migration added after the initial
   * schema, and anything the code writes by name. Do NOT guess at primary
   * keys: `deliberation_submissions` is keyed on (process_id, user_id) and has
   * no `id` column, and an invented column name produces a false alarm that
   * costs more trust than the check earns.
   */
  columns?: string[];
  /**
   * Columns that must NOT exist, with the reason. For invariants the schema
   * enforces by absence: `vote_records` has no `user_id` and
   * `vote_participation` has no `receipt_id`, and that separation IS the
   * anonymous-ballot guarantee (see supabase/README.md "Don'ts"). A migration
   * that adds either one silently converts every past vote into an
   * attributable record, which is precisely the kind of change that should
   * not be discovered later.
   */
  forbiddenColumns?: Array<{ column: string; reason: string }>;
  /** Who needs it. Appears in the log so the owner is obvious at a glance. */
  owner: string;
}

/**
 * Tables the core owns — auth, identity, processes, events, settings. These
 * exist in every hub no matter which process types are registered.
 */
export const CORE_REQUIREMENTS: SchemaRequirement[] = [
  // The tenant registry. Every request resolves through it, so a hub whose
  // database is missing it cannot serve anything at all — which makes it the
  // one table where drift is worth catching in the deploy log rather than in
  // the first 404.
  { table: "hubs", columns: ["id", "protocol_hub_id", "hostname", "name", "space_did", "status"], owner: "core/hubRegistry" },
  { table: "processes", columns: ["id", "hub_id", "type", "status", "state", "review_id"], owner: "core/processService" },
  { table: "events", columns: ["id", "event_type", "process_id", "data"], owner: "core/eventStore" },
  { table: "users", columns: ["id", "email", "display_name", "full_name", "reviews_seen_at", "edits_seen_at", "feedback_seen_at", "briefs_seen_at", "meeting_summaries_seen_at"], owner: "civic.auth" },
  { table: "sessions", owner: "civic.auth" },
  { table: "pending_verifications", columns: ["attempts", "locked_until"], owner: "civic.auth" },
  { table: "hub_settings", columns: ["key", "value"], owner: "core/hubSettings" },
  { table: "waitlist", columns: ["email", "name", "wants_test_user"], owner: "core/waitlist" },
  { table: "feedback_submissions", columns: ["screenshot_url"], owner: "civic.feedback" },
  { table: "community_inputs", columns: ["is_anonymous", "author_name"], owner: "civic.input" },
  { table: "process_reviews", owner: "civic.review" },
  { table: "review_turns", owner: "civic.review" },
  { table: "proposals", owner: "civic.proposals" },
  { table: "proposal_supports", owner: "civic.proposals" },
  { table: "proposal_drafts", columns: ["links"], owner: "civic.proposal_drafts" },
  { table: "projects", owner: "civic.projects" },
  // project_updates / project_comments: superseded by community_inputs on
  // 2026-09-06 (migration 20260906120000); dropped in a later migration.
  { table: "project_sentiments", owner: "civic.projects" },
  { table: "project_drafts", columns: ["links"], owner: "civic.project_drafts" },
  { table: "vote_drafts", columns: ["method", "custom_options", "links"], owner: "civic.vote_drafts" },
  { table: "deliberation_drafts", columns: ["sources", "links"], owner: "civic.deliberation_drafts" },
  { table: "link_previews", owner: "civic.link_preview" },
  // Universal: linking is a property of every process, not of any one handler,
  // so it belongs in core rather than behind a requiredSchema declaration.
  {
    table: "process_links",
    columns: ["id", "from_id", "to_id", "relation", "created_by"],
    owner: "core/processLinks",
  },
];

/**
 * One hub's data, table by table — what an export of a single hub walks
 * (exit rights; Adam, 2026-09-24). Every table that carries hub_id is here,
 * and only those: `hubs` is the registry and goes with the hub as one row,
 * not as rows filtered by hub_id.
 *
 * `rows: "omit"` marks a table whose rows must NOT leave with an export:
 * live credentials, which would let whoever holds the export sign in as the
 * hub's residents, and a cache the next host rebuilds for itself. The table
 * is still listed, so an exporter decides about it rather than missing it.
 *
 * tests/unit/exportManifest.test.ts derives the tables with hub_id from the
 * migrations and fails when this list and the schema disagree.
 */
export interface ExportManifestEntry {
  table: string;
  rows: "export" | "omit";
  /** Why a table is omitted. Required when rows is "omit". */
  reason?: string;
}

export const EXPORT_MANIFEST: readonly ExportManifestEntry[] = [
  { table: "active_vote_keys", rows: "export" },
  { table: "brief_responses", rows: "export" },
  { table: "community_inputs", rows: "export" },
  { table: "deliberation_drafts", rows: "export" },
  { table: "deliberation_submissions", rows: "export" },
  { table: "deliberation_votes", rows: "export" },
  { table: "events", rows: "export" },
  { table: "feedback_submissions", rows: "export" },
  { table: "hub_settings", rows: "export" },
  { table: "link_previews", rows: "omit", reason: "a cache of other sites' metadata; the next host refetches it" },
  { table: "pending_verifications", rows: "omit", reason: "live sign-in codes" },
  { table: "process_links", rows: "export" },
  { table: "process_reviews", rows: "export" },
  { table: "processes", rows: "export" },
  { table: "project_comments", rows: "export" },
  { table: "project_drafts", rows: "export" },
  { table: "project_sentiments", rows: "export" },
  { table: "project_updates", rows: "export" },
  { table: "projects", rows: "export" },
  { table: "proposal_drafts", rows: "export" },
  { table: "proposal_supports", rows: "export" },
  { table: "proposals", rows: "export" },
  { table: "review_turns", rows: "export" },
  { table: "sessions", rows: "omit", reason: "bearer credentials; residents sign in again on the new host" },
  { table: "users", rows: "export" },
  { table: "vote_drafts", rows: "export" },
  { table: "vote_participation", rows: "export" },
  { table: "vote_records", rows: "export" },
  { table: "waitlist", rows: "export" },
  { table: "wordcloud_submissions", rows: "export" },
];

/**
 * Fold duplicate requirements for the same table into one probe, unioning
 * their columns. Two owners needing the same table is normal, and probing it
 * twice would just make the log harder to read.
 */
export function mergeRequirements(
  requirements: SchemaRequirement[],
): SchemaRequirement[] {
  const byTable = new Map<string, SchemaRequirement>();

  for (const req of requirements) {
    const existing = byTable.get(req.table);
    if (!existing) {
      byTable.set(req.table, {
        table: req.table,
        columns: req.columns ? [...req.columns] : undefined,
        forbiddenColumns: req.forbiddenColumns
          ? [...req.forbiddenColumns]
          : undefined,
        owner: req.owner,
      });
      continue;
    }
    if (req.columns?.length) {
      const merged = new Set([...(existing.columns ?? []), ...req.columns]);
      existing.columns = [...merged];
    }
    if (req.forbiddenColumns?.length) {
      const seen = new Set((existing.forbiddenColumns ?? []).map((f) => f.column));
      existing.forbiddenColumns = [
        ...(existing.forbiddenColumns ?? []),
        ...req.forbiddenColumns.filter((f) => !seen.has(f.column)),
      ];
    }
    if (!existing.owner.includes(req.owner)) {
      existing.owner = `${existing.owner}, ${req.owner}`;
    }
  }

  return [...byTable.values()].sort((a, b) => a.table.localeCompare(b.table));
}

/**
 * The full contract for THIS hub: core tables plus whatever the currently
 * registered process handlers declare. Pure — takes the handler list so tests
 * can pass their own instead of standing up the real registry.
 */
export function collectRequirements(
  handlers: Array<{ type: string; requiredSchema?: SchemaRequirement[] }>,
  core: SchemaRequirement[] = CORE_REQUIREMENTS,
): SchemaRequirement[] {
  const fromHandlers = handlers.flatMap((h) =>
    (h.requiredSchema ?? []).map((req) => ({ ...req, owner: req.owner || h.type })),
  );
  return mergeRequirements([...core, ...fromHandlers]);
}

/** The contract for the live registry. */
export function currentRequirements(): SchemaRequirement[] {
  return collectRequirements(getAllHandlers());
}
