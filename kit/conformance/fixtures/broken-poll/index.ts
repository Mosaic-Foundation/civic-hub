// A deliberately broken copy of the straw poll example (examples/straw-poll):
// its answers table has no one-answer-per-resident key (./migrations), so a
// resident can answer twice. kit/scripts/prove.ts runs the conformance suite
// against it and requires it to fail.

import type { PluginPackage } from "@civic-social/plugin-sdk";
import manifest from "./manifest.js";
import handler from "./handler.js";
import { createStrawPollStore, strawPollStore } from "./store.js";

const strawPollPackage: PluginPackage = {
  name: "@civic-social-examples/plugin-broken-poll",
  version: "0.1.0",
  displayName: "Broken polls",
  manifest,
  server(host) {
    strawPollStore.bind(createStrawPollStore(host.db));
    return { handler };
  },
};

export default strawPollPackage;
