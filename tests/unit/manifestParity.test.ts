/**
 * The lists built from the process manifests equal the hand-maintained lists
 * they replaced (Architecture 2, ADR-009). tests/fixtures/manifests/parity.json
 * was written from commit 90d8a1f, before anything was derived; see
 * writeParity.ts there. Kept as a fixture: a manifest change that alters one
 * of these lists must update the fixture by hand, on purpose.
 *
 * Changed by hand once, on purpose (2026-10-21, the feature split): PLUGIN_IDS
 * now has the Plugins section's order (it had its own, which only the
 * console's plugin checkboxes showed), and the Plugins section's own settings
 * follow that order (feedback's address before the digest's hour). Same
 * members, both checked before the change. And (2026-10-21, step 6) the
 * vote_close job runs every 15 minutes, not hourly (Adam). And (step 8)
 * process_types gains display.name for vote results and briefs (additive).
 * And (2026-10-22, Architecture 3, ADR-010): the host maps two new event
 * types, civic.process.removed and civic.process.restored — the public
 * Delete/Undo an announced removal leaves on the wire; the schema contract
 * gains hubs' custody_arrangement/custodian/assurance_level and
 * process_links.to_iri (all additive).
 * And (2026-10-23, Architecture 4, ADR-011): the host gains hub_roles — a hub
 * table (HUB_TABLES), omitted from the export (derived by trigger from the
 * settings and accounts the export carries), and its schema requirement; the
 * schema contract gains events.wire_actor_did and users.identity_did /
 * identity_did_source (the DID projection; all additive).
 * And (2026-10-25, plugin session 1, ADR-014): the host gains hub_plugins (a
 * hub table, omitted from the export: the new-hub trigger records the host's
 * approved packages) and the schema contract gains hub_plugins and
 * plugin_catalog (all additive). Nothing else moved: the word cloud became a
 * package with every list it appears in unchanged.
 * And (2026-10-27, the analytics slice, ADR-016): the Activity feature
 * package adds its plugin id (analytics, last in the Plugins section, with
 * its public_numbers setting), its four tables (two derived rollups omitted
 * from the export; the reporting keys and their read log exported), their
 * schema requirements and its hourly job. All additions; nothing else moved.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_IDS } from "../../src/models/hubSettings.js";
import { PROCESS_TYPE_PLUGINS, processTypeDisplays, getAllHandlers } from "../../src/processes/registry.js";
import { HUB_TABLES } from "../../src/db/forHub.js";
import { EXPORT_MANIFEST, currentRequirements } from "../../src/db/schemaContract.js";
import { TABLE_KEYS } from "../../src/control/hubBundle/format.js";
import { mappedEventTypes } from "../../src/events/activitySerializer.js";
import { PLUGIN_SECTION_ORDER, SETTINGS_SECTIONS } from "../../src/shared/hubSettingsSections.js";
import { JOBS } from "../../src/jobs/registry.js";

const here = dirname(fileURLToPath(import.meta.url));
const before = JSON.parse(readFileSync(join(here, "../fixtures/manifests/parity.json"), "utf8")) as Record<string, unknown>;

/** Through JSON, as the fixture was written: functions and undefined drop out the same way. */
const asWritten = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("lists derived from the manifests equal the hand-maintained ones", () => {
  const now: Record<string, unknown> = {
    PLUGIN_IDS,
    PROCESS_TYPE_PLUGINS,
    HUB_TABLES,
    EXPORT_MANIFEST,
    TABLE_KEYS,
    mappedEventTypes: mappedEventTypes(),
    PLUGIN_SECTION_ORDER,
    plugins_section: SETTINGS_SECTIONS.plugins,
    JOBS,
    requirements: currentRequirements(),
    process_types: processTypeDisplays(),
    detail_paths: Object.fromEntries(getAllHandlers().map((h) => [h.type, h.detailPath?.("p_x") ?? null])),
  };

  for (const name of Object.keys(before)) {
    it(`${name}, in the same order`, () => {
      expect(asWritten(now[name])).toEqual(before[name]);
      // Same order, not only the same members: lists are iterated (exports,
      // the settings page, the crontab).
      expect(JSON.stringify(asWritten(now[name]))).toBe(JSON.stringify(before[name]));
    });
  }
});
