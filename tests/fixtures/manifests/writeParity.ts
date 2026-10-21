// One-off: writes tests/fixtures/manifests/parity.json from the hand-maintained
// lists as they were BEFORE Architecture 2 derived them from the manifests
// (2026-10-21). tests/unit/manifestParity.test.ts holds the derived lists to
// it. Never rerun it to make a red test green: change a manifest on purpose
// and update the fixture by hand, saying why.
//   npx tsx tests/fixtures/manifests/writeParity.ts
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_IDS } from "../../../src/models/hubSettings.js";
import { PROCESS_TYPE_PLUGINS, processTypeDisplays, getAllHandlers } from "../../../src/processes/registry.js";
import { HUB_TABLES } from "../../../src/db/forHub.js";
import { EXPORT_MANIFEST, currentRequirements } from "../../../src/db/schemaContract.js";
import { TABLE_KEYS } from "../../../src/control/hubBundle/format.js";
import { mappedEventTypes } from "../../../src/events/activitySerializer.js";
import { PLUGIN_SECTION_ORDER, SETTINGS_SECTIONS } from "../../../src/shared/hubSettingsSections.js";
import { JOBS } from "../../../src/jobs/registry.js";

const parity = {
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
const out = join(dirname(fileURLToPath(import.meta.url)), "parity.json");
writeFileSync(out, JSON.stringify(parity, null, 2) + "\n");
console.log(`wrote ${out}`);
