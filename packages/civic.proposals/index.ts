// The proposal plugin package (docs/PLUGIN-PACKAGE.md): its manifest, and what
// the hub runs when it loads it.

import type { PluginPackage } from "../../src/sdk/index.js";
import manifest from "./manifest.js";
import handler from "./handler.js";
import routes from "./routes.js";
import adminRoutes from "./adminRoutes.js";
import { proposalDraftKind } from "./draftKind.js";
import { proposalsStore } from "./store.js";
import { createProposalsStore } from "./storeImpl.js";

const proposalPackage: PluginPackage = {
  name: "@civic-social/plugin-proposal",
  version: "0.1.0",
  displayName: "Proposals",
  manifest,
  server(host) {
    proposalsStore.bind(createProposalsStore(host.db));
    return {
      handler,
      drafts: { kind: proposalDraftKind },
      routes: [{ path: "/proposals", router: routes }],
      adminRoutes: [{ path: "/proposals", router: adminRoutes }],
    };
  },
};

export default proposalPackage;
