// The conversation plugin package (docs/PLUGIN-PACKAGE.md): Polis-backed
// group conversations, a Tier 3 type. Its manifest, and what the hub runs when
// it loads it: the handler (the portable Polis handler, ./handler.ts, wired to
// the hub through PolisHostInterface in ./boot.ts), its routes and its draft
// kind. It reaches Polis only through the deliberation adapter its grant
// names. Its summary is its brief's, which owns the AI (plugin session 2,
// ADR-015; ADR-014 Decision 7).

import type { PluginPackage } from "../../src/sdk/index.js";
import manifest from "./manifest.js";
import { bootDeliberation } from "./boot.js";
import routes from "./routes.js";
import { deliberationDraftKind } from "./draftKind.js";
import { conversationHost } from "./host.js";

const conversationPackage: PluginPackage = {
  name: "@civic-social/plugin-conversation",
  version: "0.2.1",
  displayName: "Conversations",
  manifest,
  requires: ["@civic-social/plugin-brief"],
  server(host) {
    conversationHost.bind(host);
    return {
      handler: bootDeliberation(host),
      drafts: { kind: deliberationDraftKind },
      routes: [{ path: "/deliberations", router: routes }],
    };
  },
};

export default conversationPackage;
