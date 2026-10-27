// The brief plugin package (docs/PLUGIN-PACKAGE.md): its manifest, and what the
// hub runs when it loads it.

import type { PluginPackage } from "../../src/sdk/index.js";
import manifest from "./manifest.js";
import handler from "./handler.js";
import routes from "./routes.js";
import adminRoutes from "./adminRoutes.js";
import { briefHost } from "./host.js";

const briefPackage: PluginPackage = {
  name: "@civic-social/plugin-brief",
  version: "0.2.1",
  displayName: "Briefs",
  manifest,
  server(host) {
    briefHost.bind(host);
    return {
      handler,
      routes: [{ path: "/brief", router: routes }],
      adminRoutes: [{ path: "/briefs", router: adminRoutes }],
    };
  },
};

export default briefPackage;
