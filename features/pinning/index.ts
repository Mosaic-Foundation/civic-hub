// Pinning: any item pinned to the right column's Pinned card, with an
// optional end date and an optional urgent flag (Adam, 2026-11-15 and
// 2026-11-18; a plugin since kernel step 4, 2026-11-19: "if it can be a
// plugin, it is one"). Who may pin is the space's setting: admins (the
// default) or every member. A hub feature built as a plugin package is
// (src/plugins/feature.ts): one folder, the SDK and src/shared/ only, its own
// table, its switch plugin.pinning.enabled. No other plugin knows of it.

import type { FeaturePackage } from "../../src/sdk/index.js";
import { PINNING_MANIFEST } from "./manifest.js";
import { pinStore } from "./store.js";
import { adminPinRoutes, pinRoutes } from "./routes.js";

const pinning: FeaturePackage = {
  name: "@civic-social/feature-pinning",
  version: "0.1.0",
  displayName: "Pinning",
  manifest: PINNING_MANIFEST,
  server(host) {
    const store = pinStore(host);
    return {
      routes: [{ path: "/pins", router: pinRoutes(store) }],
      adminRoutes: [{ path: "/pins", router: adminPinRoutes(store) }],
    };
  },
};

export default pinning;
