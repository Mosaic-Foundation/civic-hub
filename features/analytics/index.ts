// Activity: the participation record (the analytics slice, 2026-10-27;
// ADR-016). How much participation a hub has, of what kind, over what
// period, for the operator (the console), the hub's admins (Admin → Activity,
// the CSV, the digest line) and outside readers (/analytics, when Public
// numbers is on or with a reporting key; the About page's block). Counted
// from the event log alone, every type by its manifest's declaration, in
// counts that never identify anyone.
//
// A hub feature built as a plugin package is (src/plugins/feature.ts): one
// folder, the SDK and src/shared/ only, its contributions through the hub's
// registries, its switch plugin.analytics.enabled.

import type { FeaturePackage } from "../../src/sdk/index.js";
import { ANALYTICS_MANIFEST } from "./manifest.js";
import { adminRouter, publicRouter } from "./routes.js";
import { rollup } from "./rollup.js";

const analytics: FeaturePackage = {
  name: "@civic-social/feature-analytics",
  version: "0.1.0",
  displayName: "Activity",
  manifest: ANALYTICS_MANIFEST,
  server(host) {
    return {
      routes: [{ path: "/analytics", router: publicRouter(host) }],
      adminRoutes: [{ path: "/analytics", router: adminRouter(host) }],
      jobs: {
        analytics: async ({ now }) => {
          const result = await rollup(host, now);
          return { status: 200, body: result as unknown as Record<string, unknown> };
        },
      },
    };
  },
};

export default analytics;
