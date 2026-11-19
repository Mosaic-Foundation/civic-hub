// The Search plugin's manifest (src/processes/manifest.ts's FeatureManifest).
// Plain data. It owns no table: the index is the kernel's (each process's
// search_doc and the search_processes functions).

import { defineFeatureManifest } from "../../src/processes/manifest.js";

export const SEARCH_MANIFEST = defineFeatureManifest({
  feature: "search",
  tables: [],
  requiredSchema: [],
  jobs: [],
  pluginSection: {
    order: 110,
    name: "Search",
    what: "Full-text search across everything on the hub.",
    fields: [],
    words: ["search", "find", "full text"],
  },
});
