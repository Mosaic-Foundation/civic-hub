// The meeting summary plugin package (docs/PLUGIN-PACKAGE.md): its manifest,
// and what the hub runs when it loads it.

import type { PluginPackage } from "@civic-social/plugin-sdk/first-party";
import manifest from "./manifest.js";
import handler from "./handler.js";
import routes from "./routes.js";
import adminRoutes from "./adminRoutes.js";
import { meetingSummaryJob } from "./job.js";
import { meetingSummaryHost } from "./host.js";

const meetingSummaryPackage: PluginPackage = {
  name: "@civic-social/plugin-meeting-summary",
  version: "0.2.0",
  displayName: "Meeting summaries",
  manifest,
  server(host) {
    meetingSummaryHost.bind(host);
    return {
      handler,
      routes: [{ path: "/meeting-summary", router: routes }],
      adminRoutes: [{ path: "/meeting-summaries", router: adminRoutes }],
      jobs: { meeting_summary: meetingSummaryJob },
    };
  },
};

export default meetingSummaryPackage;
