// A copy of the straw poll example (examples/straw-poll) whose second migration
// is not additive (./migrations): catalog:add and civic-conformance must
// refuse it before running anything.

import type { PluginPackage } from "@civic-social/plugin-sdk";
import manifest from "./manifest.js";
import handler from "./handler.js";
import { createStrawPollStore, strawPollStore } from "./store.js";

const strawPollPackage: PluginPackage = {
  name: "@civic-social-examples/plugin-not-additive",
  version: "0.1.0",
  displayName: "Not-additive polls",
  manifest,
  server(host) {
    strawPollStore.bind(createStrawPollStore(host.db));
    return { handler };
  },
};

export default strawPollPackage;
