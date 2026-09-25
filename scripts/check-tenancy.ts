// @civic-raw-client-importer: control-plane check, run by hand; it reads the catalog across every hub.
/**
 * The pre-switch check: is this database ready for hub tokens?
 *
 *   npx tsx scripts/check-tenancy.ts                                   # SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   node --env-file=.env.prod --import tsx scripts/check-tenancy.ts --prod   # PROD_SUPABASE_URL / PROD_SUPABASE_SERVICE_ROLE_KEY
 *
 * Calls `tenancy_catalog()` (20260925010000) as the service role and holds
 * every table to the same rules as tests/api/rlsCatalog.test.ts
 * (tests/fixtures/tenancyCatalog.ts): hub_id, RLS enabled and FORCEd, exactly
 * the template's `hub_isolation` policy, a hub-leading index; forHub()'s
 * HUB_TABLES equal to the hub-scoped tables; and the four post-images storage
 * policies. Prints CLEAN and exits 0, or names each offending table and exits 1.
 *
 * RUN IT RIGHT BEFORE CIVIC_HUB_MINTED_TOKEN IS TURNED ON (RUNBOOK-cutover.md).
 * A table that fails here is a table the token would either leak across hubs
 * or break outright. READ-ONLY: one RPC, no writes. No --hub: this is the
 * control plane looking at every table at once.
 */

import { createClient } from "@supabase/supabase-js";
import { HUB_TABLES } from "../src/db/forHub.js";
import {
  catalogProblems,
  NOT_HUB_SCOPED,
  storagePolicyProblems,
  type CatalogRow,
} from "../tests/fixtures/tenancyCatalog.js";

const PROD = process.argv.includes("--prod");
const url = (PROD ? process.env.PROD_SUPABASE_URL : process.env.SUPABASE_URL)?.trim();
const key = (PROD ? process.env.PROD_SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();

async function main(): Promise<number> {
  if (!url || !key) {
    console.error(`Missing ${PROD ? "PROD_SUPABASE_URL / PROD_SUPABASE_SERVICE_ROLE_KEY" : "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"}.`);
    return 2;
  }
  console.log(`tenancy catalog: ${new URL(url).host}`);

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc("tenancy_catalog");
  if (error) {
    console.error(`NOT READY: tenancy_catalog() failed: ${error.message}`);
    console.error("(Has 20260925010000_tenancy_catalog.sql been applied here?)");
    return 1;
  }
  const rows = (data ?? []) as CatalogRow[];

  const problems = [...catalogProblems(rows), ...storagePolicyProblems(rows)];

  const scoped = rows
    .filter((r) => r.table_name !== "storage.objects" && !(r.table_name in NOT_HUB_SCOPED))
    .map((r) => r.table_name);
  const missing = scoped.filter((t) => !(HUB_TABLES as readonly string[]).includes(t));
  const extra = (HUB_TABLES as readonly string[]).filter((t) => !scoped.includes(t));
  for (const t of missing) problems.push(`${t}: hub-scoped in the database but not in forHub()'s HUB_TABLES`);
  for (const t of extra) problems.push(`${t}: in HUB_TABLES but not a hub-scoped table here (not migrated?)`);
  if (!rows.some((r) => r.table_name === "storage.objects")) {
    problems.push("storage.objects: not in the catalog — no storage schema, so the post-images policies cannot be checked");
  }

  const tables = rows.filter((r) => r.table_name !== "storage.objects").length;
  if (problems.length === 0) {
    console.log(`CLEAN — ${tables} tables, ${scoped.length} hub-scoped, all forced with the template policy; post-images policies present.`);
    return 0;
  }
  console.log(`NOT READY — ${problems.length} problem(s). Do not turn hub tokens on.\n`);
  for (const p of problems) console.log(`  - ${p}`);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`check-tenancy failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  },
);
