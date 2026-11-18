// The News Sync plugin package (docs/PLUGIN-PACKAGE.md): its manifest, and
// what the hub runs when it loads it.

import type { PluginPackage } from "@civic-social/plugin-sdk/first-party";
import manifest from "./manifest.js";
import handler from "./handler.js";
import routes from "./routes.js";

const newsSyncPackage: PluginPackage = {
  name: "@civic-social/plugin-news-sync",
  version: "0.1.0",
  displayName: "News sync",
  manifest,
  server() {
    return {
      handler,
      routes: [{ path: "/news", router: routes }],
    };
  },
};

export default newsSyncPackage;
