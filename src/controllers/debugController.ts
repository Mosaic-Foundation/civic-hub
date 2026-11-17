// Debug controller — loads sample data for development testing. The kernel
// wipes the hub; the scenarios are its space type's (config/space.ts).
// NOT for production use. All actions go through normal business logic.
//
// Two-layer safeguard against accidentally wiping live data:
//   1. CIVIC_ALLOW_SEED=true must be set in the env. Default deny.
//   2. SUPABASE_URL must NOT resolve to a hostname in
//      PROTECTED_SUPABASE_HOSTS. Even if (1) is satisfied (e.g. a stale
//      flag in a local .env), seeding against a known production
//      Supabase project is hard-coded as a 403. To seed a fresh dev
//      project, leave its hostname absent from the list.

import { env } from "../config/env.js";
import { ConflictError, ForbiddenError } from "../errors/index.js";
import { route } from "../http/route.js";
import { seedAllowed } from "../config/devFlags.js";
import { clearProcesses } from "../services/processService.js";
import { clearEvents, getEventCount } from "../events/eventStore.js";
import { clearInputs } from "../modules/civic.input/index.js";
/** Empties the proposals. Loaded on first use, never as the engine starts (engine 2, ADR-017). */
// Each package empties its own records (PluginServer.dev.reset, kernel step 3).
const clearProposals = async (): Promise<void> => (await import("../services/packageContributions.js")).resetPackagesForDev();
import { clearAuth } from "../modules/civic.auth/index.js";
import { clearReceipts } from "../modules/civic.receipts/index.js";
import { countReviewTurns } from "../services/devSeedChecks.js";
import { spaceType } from "../plugins/spaceType.js";

// Production Supabase hostnames that MUST NEVER be seeded against.
// Add a new entry whenever a new production project is provisioned.
// Do NOT add dev-only project hostnames here — being absent is the
// signal that seeding is permitted (subject to CIVIC_ALLOW_SEED).
const PROTECTED_SUPABASE_HOSTS: ReadonlyArray<string> = [
  "nfhyypwoporfggqcerli.supabase.co", // Floyd Civic Hub — production
];

function supabaseHostFromEnv(): string | null {
  const raw = env.SUPABASE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const MANUAL_WIPE_HINT =
  `review_turns is append-only and wordcloud_submissions has an FK, so the JS ` +
  `client cannot cascade-delete them. In the Supabase SQL editor (DEV) run:  ` +
  `TRUNCATE review_turns, process_reviews, wordcloud_submissions CASCADE;  ` +
  `then re-hit /debug/seed. To add activity without a wipe, run  ` +
  `node --env-file=.env --import tsx scripts/seedDevActivities.ts`;

/**
 * Returns a human-readable reason the destructive reseed cannot run, or null
 * when it can. Checked before anything is deleted.
 */
async function reseedBlocker(): Promise<string | null> {
  let count: number;
  try {
    count = await countReviewTurns();
  } catch (err) {
    console.error("[seed] could not inspect review_turns:", err instanceof Error ? err.message : err);
    return "Could not check whether the database can be reseeded. Nothing was deleted.";
  }
  if (count > 0) {
    return (
      `Refusing to reseed: ${count} append-only review_turns row(s) block the ` +
      `processes wipe, and clearing events first would leave the database ` +
      `with no activity log. Nothing was deleted. ${MANUAL_WIPE_HINT}`
    );
  }
  return null;
}

export const handleSeed = route(async (_req, res) => {
  // Layer 2 — hard-coded production host denylist. Checked FIRST so a
  // stale CIVIC_ALLOW_SEED=true in a local .env can never reach prod.
  const host = supabaseHostFromEnv();
  if (host && PROTECTED_SUPABASE_HOSTS.includes(host)) {
    console.warn(
      `[seed] BLOCKED: refusing to seed against protected production host "${host}". ` +
        `Use a separate dev Supabase project for seeding.`,
    );
    throw new ForbiddenError(
      "Seeding is permanently disabled against the production database. " +
        "Use a separate Supabase project for dev seeding — see civic-hub/src/controllers/debugController.ts.",
      "seed_disabled",
    );
  }

  // Layer 1 — env flag. Default deny; opt-in per environment, and refused
  // with NODE_ENV=production whatever the flag says (Audit 2).
  if (!seedAllowed()) {
    throw new ForbiddenError(
      "Seeding is disabled in this environment. Set CIVIC_ALLOW_SEED=true to enable (never in production).",
      "seed_disabled",
    );
  }

  // Fail BEFORE destroying anything. review_turns is append-only (a BEFORE
  // DELETE trigger blocks row deletes), so once any review exists the
  // cascade processes → process_reviews → review_turns cannot run and the
  // reseed is impossible. Discovering that after clearEvents() used to
  // leave the database in its worst state — processes with no activity log,
  // which neither this endpoint nor auto-seed can repair — so the blocker is
  // checked up front and the data is left untouched.
  const blocker = await reseedBlocker();
  if (blocker) throw new ConflictError(blocker, "reseed_blocked");

  console.log("\n[seed] Clearing existing data...");
  // Clear in dependency order: events first (they reference process IDs),
  // then processes + everything else.
  await clearEvents();
  try {
    await clearProcesses();
  } catch (err) {
    // wordcloud_submissions holds an FK to processes too. PostgREST can't
    // issue TRUNCATE, so a dev reseed needs a one-time manual wipe. Surface
    // that instead of a raw 500.
    console.error("[seed] could not clear processes:", err instanceof Error ? err.message : err);
    throw new ConflictError(`Could not clear processes. ${MANUAL_WIPE_HINT}`, "reseed_blocked");
  }
  await clearInputs();
  await clearProposals();
  await clearAuth();
  await clearReceipts();

  console.log("[seed] Seeding system...");

  // What the hub is seeded with is its space type's (SpaceServer.dev, kernel step 3).
  const createdProcesses = (await spaceType()?.dev?.seedAfterReset()) ?? [];

  const eventCount = await getEventCount();

  console.log(
    `[seed] Created ${createdProcesses.length} processes, ${eventCount} events\n`,
  );

  res.json({
    message: "Seed data created",
    processes: createdProcesses,
    event_count: eventCount,
  });
});
