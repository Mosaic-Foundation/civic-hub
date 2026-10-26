// The straw poll plugin package: the worked example in docs/BUILD-A-PLUGIN.md.
// What the hub loads: its name and version, its manifest, and server(host),
// called once when the hub loads it.

import type { PluginPackage } from "@civic-social/plugin-sdk";
import manifest from "./manifest.js";
import handler from "./handler.js";
import { createStrawPollStore, strawPollStore } from "./store.js";

const strawPollPackage: PluginPackage = {
  name: "@civic-social-examples/plugin-straw-poll",
  version: "0.1.0",
  displayName: "Straw polls",
  manifest,
  server(host) {
    strawPollStore.bind(createStrawPollStore(host.db));
    return { handler };
  },
};

export default strawPollPackage;
