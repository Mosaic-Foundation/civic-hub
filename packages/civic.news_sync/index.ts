// The News Sync plugin package (docs/PLUGIN-PACKAGE.md): its manifest, and
// what the hub runs when it loads it: the News item type, its page's read,
// and the job that copies a hub's news feed in.

import type { PluginPackage } from "@civic-social/plugin-sdk";
import manifest from "./manifest.js";
import handler from "./handler.js";
import routes from "./routes.js";
import { newsSyncJob } from "./job.js";
import { newsSyncHost } from "./host.js";

const newsSyncPackage: PluginPackage = {
  name: "@civic-social/plugin-news-sync",
  version: "0.2.0",
  displayName: "News sync",
  manifest,
  server(host) {
    newsSyncHost.bind(host);
    return {
      handler,
      routes: [{ path: "/news", router: routes }],
      jobs: { news_sync: newsSyncJob },
    };
  },
};

export default newsSyncPackage;
