// The SDK tour plugin package: a conformance fixture. What the hub loads: its
// name and version, its manifest, and server(host), called once.

import type { PluginPackage } from "@civic-social/plugin-sdk";
import manifest from "./manifest.js";
import handler from "./handler.js";
import routes from "./routes.js";
import { sdkTourDraftKind } from "./draftKind.js";
import { createSdkTourStore, sdkTourStore } from "./store.js";

const sdkTourPackage: PluginPackage = {
  name: "@civic-social-examples/plugin-sdk-tour",
  version: "0.1.0",
  displayName: "SDK tour",
  manifest,
  server(host) {
    sdkTourStore.bind(createSdkTourStore(host.db));
    return {
      handler,
      drafts: { kind: sdkTourDraftKind },
      routes: [{ path: "/sdk-tour", router: routes }],
    };
  },
};

export default sdkTourPackage;
