/**
 * One-time migration script: copy the legacy announcement-authors list onto
 * the managed official role (users.official_type / official_title).
 *
 * Run from: ~/Developer/Civic-Social-Mono/civic-hub
 * Usage:    npx tsx scripts/seedOfficials.ts --dry-run
 *           npx tsx scripts/seedOfficials.ts
 *
 * Source of truth for the copy is getAnnouncementAuthors(), which reads
 * hub_settings.announcement_authors and falls back to the CIVIC_BOARD_EMAILS
 * env var when no list has been saved — so this picks up whichever of the
 * two a given environment was actually running on.
 *
 * For each entry:
 *   - find the account by email, creating a shell row when the person has
 *     never signed in (their first sign-in adopts it via unique(email))
 *   - set official_title = the legacy free-form label, verbatim
 *   - set official_type  = inferred from that label ("Board member" →
 *     board_of_supervisors), correctable afterwards in the admin panel
 *   - set display_name from the admin-curated name, ONLY when the account
 *     has none of its own
 *
 * Idempotent: an account that already has an official_type is left alone.
 * A live run finally sets the `officials_migrated` latch, after which the
 * legacy list stops granting anyone official status — that is what makes
 * demotion in the admin panel stick.
 *
 * PREREQUISITE: apply supabase/migrations/20260827100000_official_role.sql
 * to this database first. Without the columns, every write below fails.
 *
 * AGAINST PRODUCTION, PREFER THE ADMIN PANEL. Vercel refuses to export
 * secret-typed env vars — `vercel env pull --environment=production` writes
 * "[SENSITIVE]" in place of SUPABASE_SERVICE_ROLE_KEY — so running this
 * against prod means hand-placing that key in a local file first. Not worth
 * it: Admin → Settings → Officials already lists the unmigrated legacy
 * entries merged with the managed roster, and saving writes them onto user
 * rows and sets the latch. Same outcome, no service-role key on disk.
 *
 * If you do run it against another environment, pass the env file to NODE,
 * not to `env`:
 *   node --env-file=.env.production --import tsx scripts/seedOfficials.ts --dry-run
 * `env $(grep -v '^#' file | xargs)` word-splits on any value containing a
 * space (CIVIC_JURISDICTION_NAME="Floyd County, VA" makes it try to run a
 * command called `County,`). --env-file parses the file properly.
 * The script prints the target project ref on startup — read it.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env manually (no dotenv dependency) — same pattern as the other
// scripts in this folder. Existing env vars always win, so the prod
// invocation above is not overridden by a local .env.
try {
  const envPath = resolve(import.meta.dirname ?? ".", "..", ".env");
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
  }
} catch {
  // .env not found — rely on existing env vars
}

const { getDb } = await import("../src/db/client.js");
const { getAnnouncementAuthors, setOfficialsMigrated, areOfficialsMigrated } =
  await import("../src/services/hubSettings.js");
const { inferOfficialType } = await import("../src/shared/officialTypes.js");
const { generateId } = await import("../src/utils/id.js");

const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Name the database before touching it.
 *
 * The .env loader above fills in anything the caller did not set, so an
 * `env $(...) npx tsx …` invocation whose env file is MISSING the Supabase
 * keys silently falls back to the local dev project — and the run looks
 * like a success against the wrong database. (This happened: `vercel env
 * pull` without --environment=production writes the development env, which
 * carries no Supabase credentials at all.) Printing the project ref makes
 * that mistake visible in one line instead of invisible.
 */
function announceTarget(): void {
  const url = process.env.SUPABASE_URL ?? "";
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!ref) {
    console.error(
      "SUPABASE_URL is not set. Refusing to guess which database to write to.",
    );
    process.exit(1);
  }
  console.log(`Target database: ${ref}.supabase.co`);
  console.log("Check that ref is the one you meant before continuing.\n");
}

interface PlannedChange {
  email: string;
  title: string;
  type: string;
  action: "update" | "create" | "skip";
  setDisplayName: string | null;
  note: string;
}

async function main(): Promise<void> {
  announceTarget();
  const db = getDb();

  console.log(
    DRY_RUN
      ? "DRY RUN — no writes. Showing what a live run would do.\n"
      : "LIVE RUN — writing to the database.\n",
  );

  if (await areOfficialsMigrated()) {
    console.log(
      "officials_migrated is already set: this database has been migrated.\n" +
        "The roster is managed in the admin panel. Nothing to do.",
    );
    return;
  }

  const authors = await getAnnouncementAuthors();
  if (authors.length === 0) {
    console.log(
      "No legacy authors found (hub_settings.announcement_authors is empty\n" +
        "and CIVIC_BOARD_EMAILS is unset). Nothing to copy.",
    );
    if (!DRY_RUN) {
      await setOfficialsMigrated(null);
      console.log("\nSet officials_migrated — the admin panel is now the roster.");
    }
    return;
  }

  const plan: PlannedChange[] = [];

  for (const author of authors) {
    const email = author.email.trim().toLowerCase();
    const title = author.label.trim();
    const type = inferOfficialType(title);

    const { data: existing, error } = await db
      .from("users")
      .select("id, display_name, full_name, official_type, official_title")
      .eq("email", email)
      .maybeSingle();
    if (error) throw new Error(`lookup ${email}: ${error.message}`);

    const row = existing as {
      id: string;
      display_name: string | null;
      full_name: string | null;
      official_type: string | null;
    } | null;

    if (row?.official_type) {
      plan.push({
        email,
        title,
        type,
        action: "skip",
        setDisplayName: null,
        note: `already an official (${row.official_type})`,
      });
      continue;
    }

    // Curated name is a fallback for someone who has not filled in their
    // own account. Never overwrite a name the person set themselves.
    const curated = author.name?.trim() || null;
    const hasOwnName = !!(row?.full_name?.trim() || row?.display_name?.trim());
    const setDisplayName = curated && !hasOwnName ? curated : null;

    plan.push({
      email,
      title,
      type,
      action: row ? "update" : "create",
      setDisplayName,
      note: row ? "existing account" : "no account yet — shell row",
    });
  }

  for (const change of plan) {
    const name = change.setDisplayName ? `, display_name="${change.setDisplayName}"` : "";
    console.log(
      `  ${change.action.padEnd(6)} ${change.email.padEnd(32)} ` +
        `${change.type.padEnd(21)} "${change.title}"${name}  (${change.note})`,
    );
  }

  const writes = plan.filter((c) => c.action !== "skip");
  console.log(
    `\n${plan.length} legacy author(s): ${writes.length} to write, ` +
      `${plan.length - writes.length} already migrated.`,
  );

  if (DRY_RUN) {
    console.log("\nDry run complete. Re-run without --dry-run to apply.");
    return;
  }

  for (const change of writes) {
    let userId: string;
    if (change.action === "create") {
      const insert = {
        id: generateId("user"),
        email: change.email,
        // They have not proved this address yet — their first OTP sign-in
        // flips it and reuses this row. Designating someone an official is
        // also not an affirmation of residency on their behalf.
        email_verified: false,
        is_resident: false,
        digest_frequency_days: 1,
      };
      const { data, error } = await db
        .from("users")
        .insert(insert)
        .select("id")
        .single();
      if (error) throw new Error(`create ${change.email}: ${error.message}`);
      userId = (data as { id: string }).id;
    } else {
      const { data, error } = await db
        .from("users")
        .select("id")
        .eq("email", change.email)
        .single();
      if (error) throw new Error(`refetch ${change.email}: ${error.message}`);
      userId = (data as { id: string }).id;
    }

    const patch: Record<string, unknown> = {
      official_type: change.type,
      official_title: change.title,
    };
    if (change.setDisplayName) patch.display_name = change.setDisplayName;

    const { error: upErr } = await db.from("users").update(patch).eq("id", userId);
    if (upErr) throw new Error(`update ${change.email}: ${upErr.message}`);
    console.log(`  wrote ${change.email} → ${change.type} / "${change.title}"`);
  }

  await setOfficialsMigrated(null);
  console.log(
    "\nSet officials_migrated. The managed role is now the only source of\n" +
      "official status — edit the roster in Admin → Settings → Officials.",
  );
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
