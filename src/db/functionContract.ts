// Function contract — the database functions the running code calls, with the
// argument signature it calls them by.
//
// The table contract (schemaContract.ts) caught a missing column; it could not
// catch a missing function. On 2026-10-11 Audit 3's code reached dev before its
// migration: dev's transition_process still had the old arguments, /health said
// "ok", and every vote approval failed in a resident's hands. GET /health now
// compares this list with the live catalog (public.function_catalog(), migration
// 20261012000000) and reports a missing, mismatched or overloaded function as a
// gap, which turns the health check red.
//
// `args` is exactly what Postgres's pg_get_function_identity_arguments() prints:
// names and types in order, no defaults. Two tests keep the list honest:
// tests/unit/functionContract.test.ts fails when code calls `.rpc()` for a
// function not listed here (or a listed one nobody calls), and when the newest
// definition of a listed function in supabase/migrations does not have these
// arguments, so the code cannot name a signature no migration creates.

export interface FunctionRequirement {
  /** Function name in the public schema. */
  name: string;
  /** Identity arguments, as pg_get_function_identity_arguments() prints them. */
  args: string;
  /** Who calls it. Appears in the log so the owner is obvious at a glance. */
  owner: string;
}

export const FUNCTION_CONTRACT: readonly FunctionRequirement[] = [
  {
    name: "transition_process",
    args:
      "p_hub_id text, p_process_id text, p_to_status text, p_actor text, p_event jsonb, p_state jsonb, " +
      "p_expected_status text, p_expected_version bigint, p_events jsonb",
    owner: "db/atomic",
  },
  {
    name: "cast_ballot",
    args:
      "p_hub_id text, p_process_id text, p_user_id text, p_choice text, p_event jsonb, p_receipt text, " +
      "p_key_hash text, p_new_key_hash text",
    owner: "db/atomic",
  },
  { name: "reshuffle_ballots", args: "p_hub_id text, p_process_id text", owner: "db/atomic" },
  {
    name: "submit_for_review",
    args: "p_hub_id text, p_process jsonb, p_review jsonb, p_turn jsonb, p_links jsonb, p_event jsonb",
    owner: "civic.review",
  },
  { name: "claim_vote_key", args: "p_hub_id text, p_process_id text, p_user_id text, p_key_hash text", owner: "db/atomic" },
  { name: "ballot_by_receipt", args: "p_hub_id text, p_process_id text, p_receipt text", owner: "db/atomic" },
  { name: "rate_limit_take", args: "p_buckets text[], p_limits integer[], p_window_seconds integer[]", owner: "db/rateLimit" },
  { name: "rate_limit_retry_at", args: "p_bucket text, p_limit integer, p_window_seconds integer", owner: "db/rateLimit" },
  { name: "take_sign_in_attempt", args: "p_hub_id text, p_email text, p_link_hash text, p_max integer", owner: "civic.auth" },
  {
    name: "take_platform_sign_in_attempt",
    args: "p_realm text, p_purpose text, p_email text, p_link_hash text, p_max integer",
    owner: "control/platformCodes",
  },
  {
    name: "take_member_invites",
    args:
      "p_hub_id text, p_user_id text, p_emails text[], p_link_hashes text[], p_outcome text, " +
      "p_expires_at timestamp with time zone, p_limit integer, p_window_seconds integer",
    owner: "services/hubInvites",
  },
  { name: "move_hub_hostname", args: "p_hub_id text, p_from text, p_to text, p_previous_hostnames text[], p_event jsonb", owner: "control/hubs (moveHub)" },
  { name: "count_pending_reviews", args: "p_hub_id text, p_since timestamp with time zone, p_excluded_types text[]", owner: "services/adminQueues" },
  { name: "ai_tokens_since", args: "p_hub_id text, p_since timestamp with time zone, p_purposes text[]", owner: "services/aiBudget" },
  {
    name: "search_processes",
    args:
      "p_hub_id text, p_q text, p_types text[], p_from timestamp with time zone, p_to timestamp with time zone, " +
      "p_sort text, p_limit integer, p_offset integer",
    owner: "services/searchExecutor",
  },
  {
    name: "search_processes_count",
    args: "p_hub_id text, p_q text, p_types text[], p_from timestamp with time zone, p_to timestamp with time zone",
    owner: "services/searchExecutor",
  },
];

/** The function the check itself reads the catalog through (20261012000000). */
export const FUNCTION_CATALOG = "function_catalog";

export interface FunctionGap {
  name: string;
  owner: string;
  kind: "missing_function" | "mismatched_function" | "overloaded_function";
  detail: string;
}

/**
 * Compare the contract with the catalog's rows. Pure, so the verdicts are
 * pinned by a unit test rather than trusted.
 *
 * - missing: no function by that name.
 * - mismatched: one function by that name, with other arguments (PostgREST
 *   answers PGRST202 to the code's call).
 * - overloaded: more than one (PostgREST may answer PGRST203, "could not
 *   choose"), even when one of them matches.
 */
export function compareFunctions(
  contract: readonly FunctionRequirement[],
  rows: ReadonlyArray<{ name: string; identity_args: string }>,
): FunctionGap[] {
  const gaps: FunctionGap[] = [];
  for (const req of contract) {
    const found = rows.filter((r) => r.name === req.name).map((r) => r.identity_args);
    if (found.length === 0) {
      gaps.push({ name: req.name, owner: req.owner, kind: "missing_function", detail: `function ${req.name}(${req.args}) is missing` });
    } else if (found.length > 1) {
      gaps.push({
        name: req.name,
        owner: req.owner,
        kind: "overloaded_function",
        detail: `function ${req.name} has ${found.length} versions; the code calls (${req.args})`,
      });
    } else if (found[0] !== req.args) {
      gaps.push({
        name: req.name,
        owner: req.owner,
        kind: "mismatched_function",
        detail: `function ${req.name} has (${found[0]}); the code calls (${req.args})`,
      });
    }
  }
  return gaps;
}
