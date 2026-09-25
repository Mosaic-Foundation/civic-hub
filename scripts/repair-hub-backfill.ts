// @civic-raw-client-importer: operator script, run by hand outside any request; it names its hub itself.
/**
 * Repair accounts the Phase 2a backfill stamped with the wrong hub. DEV ONLY.
 *
 *   npx tsx --env-file=.env scripts/repair-hub-backfill.ts            # dry run
 *   npx tsx --env-file=.env scripts/repair-hub-backfill.ts --apply
 *
 * Why this exists. 20260924010000 added hub_id to every table with
 * DEFAULT 'floyd' (MIGRATION_DEFAULT_HUB_ID), which backfilled every existing
 * row as the migration-default hub's. On production that is exactly right —
 * one hub has ever had data there. On the shared DEV database it is not:
 * people signed in on Athens and Utopia before the migration, and their
 * accounts now read as the default hub's, so they cannot sign in on their own
 * hub (the still-global unique email refuses a second account).
 *
 * What it knows for certain. Sessions have carried the hub they were minted
 * on since 20260922050000. An account stamped with the default hub whose
 * every session is on ONE other hub belongs to that hub; it is moved there.
 * An account with sessions on several hubs is left alone and listed; one with
 * no sessions, or only the default hub's, is the default hub's.
 *
 * What it only reports. Rows those accounts created (processes, drafts,
 * comments, votes…) were backfilled the same way, but nothing records which
 * hub they were made on, so they are counted and NOT moved. Their stale
 * pending sign-in codes are deleted on --apply (they are single-use and
 * short-lived, and they block the account's next code on its real hub).
 *
 * Refuses the production project, like scripts/create-hub.ts.
 */

import { getDb } from "../src/db/client.js";
import { MIGRATION_DEFAULT_HUB_ID } from "../src/models/hub.js";

const PRODUCTION_REF = "nfhyypwoporfggqcerli";
const APPLY = process.argv.includes("--apply");

/** Tables with a user column whose rows a moved account may own. */
const OWNED: Array<{ table: string; column: string }> = [
  { table: "processes", column: "created_by" },
  { table: "proposals", column: "submitted_by" },
  { table: "projects", column: "user_id" },
  { table: "community_inputs", column: "author_id" },
  { table: "vote_participation", column: "user_id" },
  { table: "proposal_drafts", column: "user_id" },
  { table: "vote_drafts", column: "user_id" },
  { table: "project_drafts", column: "user_id" },
  { table: "deliberation_drafts", column: "user_id" },
];

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL ?? "";
  const ref = url.replace(/^https:\/\/([^.]+).*/, "$1");
  if (ref === PRODUCTION_REF) {
    throw new Error("Refusing to run against the production project.");
  }
  console.log(`project: ${url}\nmode:    ${APPLY ? "APPLY" : "dry run (pass --apply to write)"}\n`);

  const db = getDb();
  const { data: sessions, error: sErr } = await db.from("sessions").select("user_id, hub_id");
  if (sErr) throw new Error(`sessions: ${sErr.message}`);
  const hubsByUser = new Map<string, Set<string>>();
  for (const s of (sessions ?? []) as Array<{ user_id: string; hub_id: string }>) {
    const set = hubsByUser.get(s.user_id) ?? new Set<string>();
    set.add(s.hub_id);
    hubsByUser.set(s.user_id, set);
  }

  const { data: users, error: uErr } = await db
    .from("users")
    .select("id, email, hub_id")
    .eq("hub_id", MIGRATION_DEFAULT_HUB_ID);
  if (uErr) throw new Error(`users: ${uErr.message}`);

  const moves: Array<{ id: string; email: string; to: string }> = [];
  const ambiguous: Array<{ email: string; hubs: string[] }> = [];
  for (const u of (users ?? []) as Array<{ id: string; email: string }>) {
    const hubs = [...(hubsByUser.get(u.id) ?? [])];
    const others = hubs.filter((h) => h !== MIGRATION_DEFAULT_HUB_ID);
    if (others.length === 0) continue; // default hub's own, or never signed in
    if (hubs.length !== 1) {
      ambiguous.push({ email: u.email, hubs });
      continue;
    }
    moves.push({ id: u.id, email: u.email, to: others[0] });
  }

  console.log(`accounts to move: ${moves.length}`);
  for (const m of moves) {
    const counts: string[] = [];
    for (const o of OWNED) {
      const { count } = await db
        .from(o.table)
        .select("*", { count: "exact", head: true })
        .eq(o.column, m.id)
        .eq("hub_id", MIGRATION_DEFAULT_HUB_ID);
      if (count) counts.push(`${o.table} ${count}`);
    }
    console.log(
      `  ${m.email.padEnd(36)} → ${m.to}` +
        (counts.length ? `   owns, NOT moved: ${counts.join(", ")}` : ""),
    );
  }
  if (ambiguous.length) {
    console.log(`\nleft alone, sessions on several hubs: ${ambiguous.length}`);
    for (const a of ambiguous) console.log(`  ${a.email.padEnd(36)} ${a.hubs.join(", ")}`);
  }

  if (!APPLY || moves.length === 0) return;

  for (const m of moves) {
    const { error } = await db.from("users").update({ hub_id: m.to }).eq("id", m.id);
    if (error) {
      console.error(`  ${m.email}: ${error.message}`);
      continue;
    }
    await db
      .from("pending_verifications")
      .delete()
      .eq("email", m.email)
      .eq("hub_id", MIGRATION_DEFAULT_HUB_ID);
    console.log(`  moved ${m.email} → ${m.to}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
