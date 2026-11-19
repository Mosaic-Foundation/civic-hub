// Members: the member count and faces on the home page, the Members page and
// its section in the navigation (a kernel feature until kernel step 4,
// 2026-11-19: "if it can be a plugin, it is one"). Membership itself, who has
// joined and the person's own switch to hide from these, stays the kernel's
// (SDK `membership`), as does "Share this hub". A hub feature built as a
// plugin package is (src/plugins/feature.ts): one folder, the SDK and
// src/shared/ only, its switch plugin.members.enabled.

import type { FeaturePackage } from "../../src/sdk/index.js";
import { MEMBERS_MANIFEST } from "./manifest.js";
import { adminMemberRoutes, memberRoutes, memberVisibility } from "./routes.js";

const members: FeaturePackage = {
  name: "@civic-social/feature-members",
  version: "0.1.0",
  displayName: "Members",
  manifest: MEMBERS_MANIFEST,
  server() {
    return {
      routes: [{ path: "/members", router: memberRoutes() }],
      adminRoutes: [{ path: "/hub/members", router: adminMemberRoutes() }],
      // Whether residents get the page and its section yet, before any page loads.
      hubConfig: async () => ({ page_shown: (await memberVisibility()).pageShown }),
    };
  },
};

export default members;
