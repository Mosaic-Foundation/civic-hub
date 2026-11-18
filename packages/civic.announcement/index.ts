// The announcement plugin package (docs/PLUGIN-PACKAGE.md): its manifest, and
// what the hub runs when it loads it.

import type { PluginPackage } from "@civic-social/plugin-sdk";
import manifest from "./manifest.js";
import handler from "./handler.js";
import routes, { listRouter } from "./routes.js";
import adminRoutes from "./adminRoutes.js";
import { announcementHost } from "./host.js";
import { pinnedCard } from "./pinnedCard.js";

const announcementPackage: PluginPackage = {
  name: "@civic-social/plugin-announcement",
  version: "0.4.0",
  displayName: "Announcements",
  manifest,
  server(host) {
    announcementHost.bind(host);
    return {
      handler,
      routes: [
        // Board / Admin announcements — post, edit, read one
        { path: "/announcement", router: routes },
        { path: "/announcements", router: listRouter },
      ],
      adminRoutes: [
        { path: "/moderation/announcements", router: adminRoutes },
      ],
      // Urgent announcements at the top of the hub's Pinned card, and the
      // newest few when nothing is pinned (./pinnedCard.ts).
      pinnedCard,
    };
  },
};

export default announcementPackage;
