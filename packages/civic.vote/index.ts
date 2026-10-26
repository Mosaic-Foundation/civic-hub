// The vote plugin package (docs/PLUGIN-PACKAGE.md): its manifest, and what the
// hub runs when it loads it.

import { route, requireResident, voteDurationLimitsSync, type PluginPackage } from "../../src/sdk/index.js";
import manifest from "./manifest.js";
import handler from "./handler.js";
import routes from "./routes.js";
import { voteDraftKind } from "./draftKind.js";

const votePackage: PluginPackage = {
  name: "@civic-social/plugin-vote",
  version: "0.1.0",
  displayName: "Votes",
  manifest,
  server() {
    return {
      handler,
      drafts: {
        kind: voteDraftKind,
        extend(router) {
          // The hub's allowed voting windows, for the duration picker.
          router.get("/duration-limits", requireResident, route((_req, res) => {
            const { minDays, maxDays, defaultDays } = voteDurationLimitsSync();
            res.json({ min_days: minDays, max_days: maxDays, default_days: defaultDays });
          }));
        },
      },
      routes: [{ path: "/votes", router: routes }],
    };
  },
};

export default votePackage;
