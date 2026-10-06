// @civic-raw-client-importer: operator script, run by hand outside any request; it names its hub itself.
/**
 * Seed a hub's sample content (Phase 7).
 *
 *   node --env-file=<env file> --import tsx scripts/seed-sample-content.ts --hub <slug> [--dry-run]
 *
 * The same seed as the console's "Start with sample content" checkbox
 * (src/services/sampleSeed.ts): up to eleven place-neutral processes from
 * src/services/sampleTemplates.ts, filled with the hub's name, jurisdiction
 * and governing body, marked `is_sample`, written through the real code
 * paths. Templates that do not fit the hub's kind or jurisdiction type are
 * skipped and listed; plugin switches are not consulted (2026-09-27). On a
 * hub seeded before 2026-10-06 a second run adds only the two newer
 * templates (the meeting summary and the word cloud).
 *
 * IDEMPOTENT. Fixed ids per hub; a second run creates nothing and says so.
 * To take the content out, use the hub's Settings → Sample content (it takes
 * a fresh code and is audited) — this script only adds.
 *
 * SENDS NOTHING. The outcome's delivery goes to a mailer that logs; the
 * conversation is served by the seed- mock layer, not Polis.
 *
 * Refuses the production project, like scripts/create-hub.ts: a production
 * hub gets its sample content from the console at creation.
 */

import { hubArg, withScriptHub } from "./lib/hubScope.js";

const PRODUCTION_REF = "nfhyypwoporfggqcerli";

const argv = process.argv.slice(2);
hubArg(argv); // exits with usage when --hub is missing
const DRY_RUN = argv.includes("--dry-run");

const supabaseUrl = process.env.SUPABASE_URL ?? "";
if (supabaseUrl.includes(PRODUCTION_REF)) {
  console.error("seed-sample-content: refusing the production database. Use the console's create form.");
  process.exit(2);
}

const { seedSampleContent } = await import("../src/services/sampleSeed.js");

await withScriptHub(async (hub) => {
  const report = await seedSampleContent({ dryRun: DRY_RUN });
  const verb = DRY_RUN ? "would create" : "created";
  console.log(`\n${hub.id}: ${verb} ${report.created.length}, already there ${report.existing.length}, skipped ${report.skipped.length}`);
  for (const k of report.created) console.log(`  + ${k}`);
  for (const k of report.existing) console.log(`  = ${k} (exists)`);
  for (const s of report.skipped) console.log(`  - ${s.key}: ${s.reason}`);
  if (!DRY_RUN) console.log(`  ${report.authors} sample authors upserted`);
});
