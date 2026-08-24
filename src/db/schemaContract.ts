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
  { table: "processes", columns: ["id", "type", "status", "state", "review_id"], owner: "core/processService" },
  { table: "events", columns: ["id", "event_type", "process_id", "data"], owner: "core/eventStore" },
  { table: "users", columns: ["id", "email", "display_name", "full_name", "reviews_seen_at"], owner: "civic.auth" },
  { table: "sessions", owner: "civic.auth" },
  { table: "pending_verifications", columns: ["attempts", "locked_until"], owner: "civic.auth" },
  { table: "hub_settings", columns: ["key", "value"], owner: "core/hubSettings" },
  { table: "waitlist", columns: ["email", "name", "wants_test_user"], owner: "core/waitlist" },
  { table: "feedback_submissions", owner: "civic.feedback" },
  { table: "community_inputs", columns: ["is_anonymous", "author_name"], owner: "civic.input" },
  { table: "process_reviews", owner: "civic.review" },
  { table: "review_turns", owner: "civic.review" },
  { table: "proposals", owner: "civic.proposals" },
  { table: "proposal_supports", owner: "civic.proposals" },
  { table: "proposal_drafts", owner: "civic.proposal_drafts" },
  { table: "projects", owner: "civic.projects" },
  { table: "project_updates", owner: "civic.projects" },
  { table: "project_comments", owner: "civic.projects" },
  { table: "project_sentiments", owner: "civic.projects" },
  { table: "project_drafts", owner: "civic.project_drafts" },
  { table: "vote_drafts", columns: ["method", "custom_options"], owner: "civic.vote_drafts" },
  { table: "link_previews", owner: "civic.link_preview" },
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
