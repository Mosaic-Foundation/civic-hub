// The vote results plugin package (docs/PLUGIN-PACKAGE.md): its manifest, and
// what the hub runs when it loads it.

import type { PluginPackage } from "../../src/sdk/index.js";
import manifest from "./manifest.js";
import handler from "./handler.js";
import routes from "./routes.js";
import adminRoutes from "./adminRoutes.js";
import { voteResultsHost } from "./host.js";

const voteResultsPackage: PluginPackage = {
  name: "@civic-social/plugin-vote-results",
  version: "0.1.1",
  displayName: "Vote results",
  manifest,
  requires: ["@civic-social/plugin-vote"],
  server(host) {
    voteResultsHost.bind(host);
    return {
      handler,
      routes: [{ path: "/vote-results", router: routes }],
      adminRoutes: [{ path: "/vote-results", router: adminRoutes }],
    };
  },
};

export default voteResultsPackage;
