// @civic-raw-client-importer: operator script, run by hand outside any request; it names its hub itself.
/**
 * Give a hub made before 2026-10-13 the starter word cloud every new hub now
 * gets (admin menu slice; src/services/starterWordcloud.ts).
 *
 *   node --env-file=<env file> --import tsx scripts/add-starter-wordcloud.ts --hub <slug> [--dry-run]
 *
 * Adds one open word cloud with the general starter prompt and chooses it as
 * the hub's word cloud (the strip at the top of every page). Recorded in the
 * hub's admin log as "Added the starter word cloud".
 *
 * Does nothing, and says why, when:
 *   - the hub already has a word cloud chosen;
 *   - an admin chose None (the setting is saved empty);
 *   - the hub's Word clouds plugin is off;
 *   - the hub is a demo with sample content: its visitors' words must never
 *     reach the real record (Adam, 2026-10-13). Use the console's "Refresh
 *     samples", which adds the sample word cloud where its kind has one.
 *
 * IDEMPOTENT: a second run finds the starter chosen and stops.
 */

import { hubArg, withScriptHub } from "./lib/hubScope.js";

const argv = process.argv.slice(2);
hubArg(argv); // exits with usage when --hub is missing
const DRY_RUN = argv.includes("--dry-run");

const { ensureStarterWordcloud, STARTER_WORDCLOUD } = await import("../src/services/starterWordcloud.js");
const { hubContentFlags } = await import("../src/services/sampleContent.js");
const { getSetting, isPluginEnabled } = await import("../src/services/hubSettings.js");
const { fetchHubSettings } = await import("../src/db/hubSettingsStore.js");
const { getProcess } = await import("../src/services/processService.js");
const { KEYS } = await import("../src/models/hubSettings.js");

await withScriptHub(async (hub) => {
  const key = KEYS.PLUGIN_WORDCLOUD_ONBOARDING_ID;
  if (hub.mode === "demo" && (await hubContentFlags(hub.id)).samples) {
    console.log(`${hub.id}: a demo hub with sample content. Use "Refresh samples" in the console instead.`);
    return;
  }
  if (DRY_RUN) {
    const chosen = await getSetting(hub.id, key);
    const stored = (await fetchHubSettings(hub.id))?.[key];
    const why = !(await isPluginEnabled(hub.id, "wordcloud"))
      ? "skip: Word clouds is off"
      : chosen && (await getProcess(chosen))
        ? `skip: already has ${chosen}`
        : stored === ""
          ? "skip: an admin chose None"
          : `would add "${STARTER_WORDCLOUD.title}" and choose it`;
    console.log(`${hub.id}: ${why} (--dry-run, nothing written)`);
    return;
  }
  const outcome = await ensureStarterWordcloud("add-starter-wordcloud", { respectNone: true });
  console.log(`${hub.id}: ${"created" in outcome ? `added ${outcome.created} and chose it` : `skip: ${outcome.skipped}`}`);
});
