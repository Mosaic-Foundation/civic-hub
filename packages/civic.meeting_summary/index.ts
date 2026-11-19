// The meeting summary plugin package (docs/PLUGIN-PACKAGE.md): its manifest,
// and what the hub runs when it loads it.

import type { PluginPackage } from "@civic-social/plugin-sdk";
import manifest from "./manifest.js";
import handler from "./handler.js";
import routes from "./routes.js";
import adminRoutes from "./adminRoutes.js";
import { meetingSummaryJob } from "./job.js";
import { meetingSummaryHost } from "./host.js";
import { parseWixFields } from "./wixFields.js";
import { meetingSummarySamples } from "./samples.js";

const meetingSummaryPackage: PluginPackage = {
  name: "@civic-social/plugin-meeting-summary",
  version: "0.3.0",
  displayName: "Meeting summaries",
  manifest,
  server(host) {
    meetingSummaryHost.bind(host);
    return {
      handler,
      routes: [{ path: "/meeting-summary", router: routes }],
      adminRoutes: [{ path: "/meeting-summaries", router: adminRoutes }],
      jobs: { meeting_summary: meetingSummaryJob },
      // Its own setting's check on save (kernel step 3): the Wix columns read as a map.
      checkSetting: (key, value) => (key === "plugin.meeting_summary.wix_fields" ? parseWixFields(value).errors[0] ?? null : null),
      samples: meetingSummarySamples,
    };
  },
};

export default meetingSummaryPackage;
