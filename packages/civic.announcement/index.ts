// The announcement plugin package (docs/PLUGIN-PACKAGE.md): its manifest, and
// what the hub runs when it loads it.

import type { PluginPackage } from "@civic-social/plugin-sdk/first-party";
import manifest from "./manifest.js";
import handler from "./handler.js";
import routes, { listRouter } from "./routes.js";
import adminRoutes, { boardRouter } from "./adminRoutes.js";
import { announcementHost } from "./host.js";

const announcementPackage: PluginPackage = {
  name: "@civic-social/plugin-announcement",
  version: "0.3.0",
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
        // Admin → Announcements: pinned and urgent, pin and unpin.
        { path: "/announcements", router: boardRouter },
      ],
    };
  },
};

export default announcementPackage;
