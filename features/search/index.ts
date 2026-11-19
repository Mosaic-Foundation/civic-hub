// Search: the Search page and the search box in the top bar (a kernel route
// and page until kernel step 4, 2026-11-19: "if it can be a plugin, it is
// one"). The index it reads, every plugin's items, stays the kernel's (SDK
// `search`), so a link's typeahead works with Search off. A hub feature built
// as a plugin package is (src/plugins/feature.ts): one folder, the SDK and
// src/shared/ only, its switch plugin.search.enabled.

import type { FeaturePackage } from "../../src/sdk/index.js";
import { SEARCH_MANIFEST } from "./manifest.js";
import { searchRoutes } from "./routes.js";

const searchFeature: FeaturePackage = {
  name: "@civic-social/feature-search",
  version: "0.1.0",
  displayName: "Search",
  manifest: SEARCH_MANIFEST,
  server() {
    return { routes: [{ path: "/search", router: searchRoutes() }] };
  },
};

export default searchFeature;
