// The Pinning plugin's manifest (src/processes/manifest.ts's FeatureManifest).
// Plain data: the host reads its table and its Plugins entry without loading
// its code.

import { defineFeatureManifest } from "../../src/processes/manifest.js";

export const PINNING_MANIFEST = defineFeatureManifest({
  feature: "pinning",
  tables: [
    {
      name: "process_pins",
      rows: "export",
      key: ["hub_id", "process_id"],
      holds: "the items pinned to the Pinned card, who pinned each and when, its end date and whether it is urgent",
    },
  ],
  requiredSchema: [
    {
      table: "process_pins",
      columns: ["hub_id", "process_id", "pinned_by", "pinned_at", "pinned_until", "urgent"],
      owner: "features/pinning",
    },
  ],
  jobs: [],
  pluginSection: {
    order: 95,
    name: "Pinning",
    what: "Pin any item to the Pinned card in the right column, with an optional end date. A pin can be marked urgent: it is listed first and shown as a line across the top of every page.",
    fields: [{ key: "plugin.pinning.who", kind: "choice", options: ["admins", "members"] }],
    words: ["pin", "pinned", "sticky", "right column", "featured", "urgent", "who can pin"],
  },
});
