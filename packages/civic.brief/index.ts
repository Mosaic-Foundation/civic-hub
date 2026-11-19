// The brief plugin package (docs/PLUGIN-PACKAGE.md): its manifest, and what the
// hub runs when it loads it.

import type { PluginPackage } from "@civic-social/plugin-sdk";
import manifest from "./manifest.js";
import handler from "./handler.js";
import routes from "./routes.js";
import legacyRoutes from "./legacyRoutes.js";
import adminRoutes from "./adminRoutes.js";
import { briefHost } from "./host.js";
import { briefOnClose } from "./onClosed.js";
import { briefSamples } from "./samples.js";

const briefPackage: PluginPackage = {
  name: "@civic-social/plugin-brief",
  version: "0.4.0",
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
      // The kernel's "process closed" event (kernel step 3): make the pending brief.
      on: { processClosed: async (closed) => void (await briefOnClose(closed)) },
      samples: briefSamples,
    };
  },
};

export default briefPackage;
