// Who may run each database function in `public` (migration 20261012100000).
//
// Postgres lets PUBLIC execute a new function, and a hosted Supabase project
// also grants new functions to anon by name; on hosted dev anon could run
// tenancy_catalog(). This reads the catalog and fails when:
//   - PUBLIC or anon can run any function in public that is not on
//     ANON_ALLOWED below (empty: nothing needs it);
//   - authenticated or service_role can run anything other than the sets
//     below, which are the migration's grants, by name;
//   - a function the postgres role creates from now on would get EXECUTE for
//     anyone but postgres (default privileges).
//
// Asked of the catalog with has_function_privilege(), never by calling a
// function as a role that may not run it: on the local Supabase image that
// call crashes the database backend (signal 11; TESTING.md, Audit 4).
// LOCAL ONLY (pg on the stack). Needs no server; runs in both CI passes.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
{
  const host = new URL(DB_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`functionGrants: refusing ${host}; local stack only.`);
}

/** Functions PUBLIC or anon may run. Each entry needs a reason next to it. */
const ANON_ALLOWED: readonly string[] = [];

/** What the hub calls with a minted hub token, and what those calls reach as the caller. */
const AUTHENTICATED = [
  "_civic_end_unverified_sessions",
  "_civic_insert_event",
  "_civic_json_strings",
  "_civic_lock_process",
  "_civic_public_search_text",
  "_civic_search_publishable",
  "ai_tokens_since",
  // An install, a removal or a wind-down with its settings (ADR-014).
  "apply_plugin_change",
  "ballot_by_receipt",
  // Events 0.3.0: the trigger that refuses "going" past an event's limit (P0001).
  "calendar_attendance_capacity",
  "cast_ballot",
  "claim_vote_key",
  "count_pending_reviews",
  "current_hub_id",
  // The event log read as counts, for the Activity feature (ADR-016).
  "event_actor_counts",
  "event_counts_by_day",
  "reshuffle_ballots",
  "search_processes",
  "search_processes_count",
  "submit_for_review",
  "take_member_invites",
  "take_sign_in_attempt",
  "transition_process",
];

/** The same, plus the operator and catalog functions. */
const SERVICE_ROLE = [
  ...AUTHENTICATED,
  // A version the operator marked required, applied to every hub by the loader (ADR-015), and the ordering it uses.
  "_civic_semver",
  "apply_required_plugin_version",
  "cast_vote",
  "function_catalog",
  "move_hub_hostname",
  "rate_limit_retry_at",
  "rate_limit_take",
  "take_platform_sign_in_attempt",
  "tenancy_catalog",
].sort();

interface GrantRow {
  name: string;
  public: boolean;
  anon: boolean;
  authenticated: boolean;
  service_role: boolean;
}

let db: pg.Client;

beforeAll(async () => {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
});

afterAll(async () => {
  await db?.end();
});

async function grants(): Promise<GrantRow[]> {
  const { rows } = await db.query<GrantRow>(
    `SELECT p.oid::regprocedure::text AS name,
            EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public,
            has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
            has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role
       FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
      ORDER BY 1`,
  );
  return rows;
}

const bareName = (signature: string) => signature.replace(/\(.*$/, "");
const runnableBy = (rows: GrantRow[], role: keyof Omit<GrantRow, "name">) =>
  [...new Set(rows.filter((r) => r[role]).map((r) => bareName(r.name)))].sort();

describe("database function grants", () => {
  it("PUBLIC and anon can run nothing in public that is not on the allow list", async () => {
    const rows = await grants();
    expect(rows.length).toBeGreaterThan(30);
    const open = rows.filter((r) => (r.public || r.anon) && !ANON_ALLOWED.includes(bareName(r.name)));
    expect(open.map((r) => `${r.name}${r.public ? " PUBLIC" : ""}${r.anon ? " anon" : ""}`)).toEqual([]);
  });

  it("authenticated and service_role can run exactly what they are granted", async () => {
    const rows = await grants();
    expect(runnableBy(rows, "authenticated")).toEqual([...AUTHENTICATED].sort());
    expect(runnableBy(rows, "service_role")).toEqual(SERVICE_ROLE);
  });

  it("a new function is runnable by no one but its owner until a migration grants it", async () => {
    await db.query("BEGIN");
    try {
      await db.query("SET LOCAL ROLE postgres");
      await db.query("CREATE FUNCTION public.zz_function_grants_probe() RETURNS int LANGUAGE sql AS 'SELECT 1'");
      const probe = (await grants()).find((r) => r.name === "zz_function_grants_probe()");
      expect(probe).toEqual({
        name: "zz_function_grants_probe()",
        public: false,
        anon: false,
        authenticated: false,
        service_role: false,
      });
    } finally {
      await db.query("ROLLBACK");
    }
  });
});
