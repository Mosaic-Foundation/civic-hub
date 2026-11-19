// The vote plugin package (docs/PLUGIN-PACKAGE.md): its manifest, and what the
// hub runs when it loads it.

import { route, requireResident, type PluginPackage } from "@civic-social/plugin-sdk";
import manifest from "./manifest.js";
import handler from "./handler.js";
import routes from "./routes.js";
import { voteDraftKind } from "./draftKind.js";
import { voteDurationLimits } from "./settings.js";
import { voteSamples } from "./samples.js";

const votePackage: PluginPackage = {
  name: "@civic-social/plugin-vote",
  version: "0.4.0",
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
            const { minDays, maxDays, defaultDays } = voteDurationLimits();
            res.json({ min_days: minDays, max_days: maxDays, default_days: defaultDays });
          }));
        },
      },
      routes: [{ path: "/votes", router: routes }],
      samples: voteSamples,
    };
  },
};

export default votePackage;
