// @civic-raw-client-importer: operator script, run by hand outside any request; it names its hub itself.
/**
 * Would the resident digest reach the same people it reaches today?
 *
 *   node --env-file=.env --import tsx scripts/check-digest-recipients.ts --hub floyd
 *   node --env-file=<pulled prod env> --env-file=<prod db env> --import tsx \
 *     scripts/check-digest-recipients.ts --hub floyd --pre-cutover [--show]
 *
 * WHY. Under `main` the digest has no mail guard: every subscribed resident is
 * mailed, and beta mode only gates sign-in. Under `multi-tenant` every job runs
 * inside its hub's scope (Phase 2c), so src/services/mailGuard.ts applies to
 * the digest too: while a hub is not `live`, mail goes only to its admin
 * roster and its beta allow list. Floyd is `beta`. A subscriber on neither list
 * would quietly stop getting the digest the morning after cutover. On
 * production's copy (2026-09-25) that was 3 of Floyd's 28 subscribers.
 *
 * TWO MODES.
 *   default        On a migrated database: the digest's own query
 *                  (`listSubscribedUsers`) and the real guard (`mailDecision`),
 *                  inside the hub's scope with its settings loaded.
 *   --pre-cutover  On production BEFORE the migrations (no `hubs` table yet):
 *                  the same subscriber query, and the same two lists the guard
 *                  will read after the cutover seed — the admin roster from
 *                  CIVIC_ADMIN_EMAILS (what seed-hub-settings.ts writes to
 *                  people.admin_emails) and the `beta_allowlist` row. Run it the
 *                  day before, while `main` can still save the allow list: after
 *                  the migrations `main`'s settings save fails (42P10).
 *
 * Prints how many would be mailed and each subscriber who would be withheld
 * (address masked; `--show` prints it in full so the operator can add it to
 * the allow list). Exit 0 when nobody is withheld, 1 otherwise. READ-ONLY:
 * no mail, no writes.
 */

import { createClient } from "@supabase/supabase-js";
import { hubArg, withScriptHub } from "./lib/hubScope.js";
import { KEYS, asEmailList } from "../src/models/hubSettings.js";

const SHOW = process.argv.includes("--show");
const PRE = process.argv.includes("--pre-cutover");

const mask = (email: string): string => {
  if (SHOW) return email;
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}…@${domain ?? "?"}`;
};

type Subscriber = { email: string; created_at: string };

function report(subscribers: Subscriber[], allowed: (email: string) => boolean): number {
  const withheld = subscribers.filter((u) => !allowed(u.email));
  console.log(`digest subscribers (what main mails today): ${subscribers.length}`);
  console.log(`would be mailed under multi-tenant:         ${subscribers.length - withheld.length}`);
  console.log(`would be WITHHELD by the beta mail guard:   ${withheld.length}`);
  for (const u of withheld) console.log(`  - ${mask(u.email)}  (joined ${String(u.created_at).slice(0, 10)})`);
  if (withheld.length > 0) {
    console.log("\nAdd each to the hub's beta allow list (Admin → Settings), then run this again.");
  }
  return withheld.length === 0 ? 0 : 1;
}

async function preCutover(): Promise<number> {
  hubArg(); // the same --hub contract as every operator script; the schema has no hubs yet
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unset.");
  const admins = process.env.CIVIC_ADMIN_EMAILS?.trim() ?? "";
  if (/^\[SENSITIVE\]$/i.test(admins)) {
    throw new Error('CIVIC_ADMIN_EMAILS holds "[SENSITIVE]"; pass the real value on the command line.');
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const subs = await db.from("users").select("email, created_at").not("digest_frequency_days", "is", null);
  if (subs.error) throw new Error(`users: ${subs.error.message}`);
  const rows = await db.from("hub_settings").select("key, value").in("key", ["beta_allowlist", KEYS.BETA_ALLOWLIST]);
  if (rows.error) throw new Error(`hub_settings: ${rows.error.message}`);

  const adminList = asEmailList(admins);
  const allowList = (rows.data ?? []).flatMap((r) => asEmailList(r.value as string));
  const allow = new Set([...adminList, ...allowList]);
  console.log(`[pre-cutover] ${new URL(url).host}`);
  console.log(`admin roster (CIVIC_ADMIN_EMAILS): ${adminList.length}   allow list: ${new Set(allowList).size}`);
  return report(subs.data as Subscriber[], (e) => allow.has(e.trim().toLowerCase()));
}

async function migrated(): Promise<number> {
  const { listSubscribedUsers } = await import("../src/modules/civic.auth/index.js");
  const { mailDecision } = await import("../src/services/mailGuard.js");
  const { getSettingSync, hubModeSync } = await import("../src/services/hubSettings.js");
  return withScriptHub(async (hub) => {
    console.log(`mode: ${hubModeSync()}`);
    console.log(
      `admin roster: ${asEmailList(getSettingSync(KEYS.PEOPLE_ADMIN_EMAILS)).length}   ` +
        `beta allow list: ${asEmailList(getSettingSync(KEYS.BETA_ALLOWLIST)).length}`,
    );
    const users = await listSubscribedUsers(hub.id);
    return report(users, (e) => mailDecision(e).send);
  });
}

(PRE ? preCutover() : migrated()).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`check-digest-recipients failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  },
);
