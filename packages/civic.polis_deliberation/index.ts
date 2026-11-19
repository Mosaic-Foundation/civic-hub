// The conversation plugin package (docs/PLUGIN-PACKAGE.md): Polis-backed
// group conversations, a Tier 3 type. Its manifest, and what the hub runs when
// it loads it: the handler (the portable Polis handler, ./handler.ts, wired to
// the hub through PolisHostInterface in ./boot.ts), its routes and its draft
// kind. It reaches Polis only through the deliberation adapter its grant
// names. Its summary is written up by whatever package writes results (Briefs,
// which owns the AI; plugin session 2, ADR-015) and kept on the conversation
// (keepResult), so its closed page needs no other package (kernel step 1).

import type { PluginPackage } from "@civic-social/plugin-sdk";
import manifest from "./manifest.js";
import { bootDeliberation } from "./boot.js";
import routes from "./routes.js";
import { deliberationDraftKind } from "./draftKind.js";
import { conversationHost } from "./host.js";
import { conversationSamples } from "./samples.js";

const conversationPackage: PluginPackage = {
  name: "@civic-social/plugin-conversation",
  version: "0.4.0",
  displayName: "Conversations",
  manifest,
  server(host) {
    conversationHost.bind(host);
    return {
      handler: bootDeliberation(host),
      drafts: { kind: deliberationDraftKind },
      routes: [{ path: "/deliberations", router: routes }],
      samples: conversationSamples,
    };
  },
};

export default conversationPackage;
