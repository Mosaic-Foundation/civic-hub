// The brief plugin package (docs/PLUGIN-PACKAGE.md): its manifest, and what the
// hub runs when it loads it.

import type { PluginPackage } from "@civic-social/plugin-sdk/first-party";
import manifest from "./manifest.js";
import handler from "./handler.js";
import routes from "./routes.js";
import legacyRoutes from "./legacyRoutes.js";
import adminRoutes from "./adminRoutes.js";
import { briefHost } from "./host.js";

const briefPackage: PluginPackage = {
  name: "@civic-social/plugin-brief",
  version: "0.3.0",
  displayName: "Briefs",
  manifest,
  server(host) {
    briefHost.bind(host);
    return {
      handler,
      routes: [
        { path: "/brief", router: routes },
        // The retired vote results' addresses, now briefs (engine 2, C).
        { path: "/vote-results", router: legacyRoutes },
      ],
      adminRoutes: [{ path: "/briefs", router: adminRoutes }],
    };
  },
};

export default briefPackage;
