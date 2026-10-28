// The word cloud plugin package (docs/PLUGIN-PACKAGE.md): its manifest, and
// what the hub runs when it loads it.

import type { PluginPackage } from "@civic-social/plugin-sdk/first-party";
import manifest from "./manifest.js";
import handler from "./handler.js";
import routes from "./routes.js";
import { wordcloudStore } from "./store.js";
import { createWordcloudStore } from "./storeImpl.js";

const wordcloudPackage: PluginPackage = {
  name: "@civic-social/plugin-wordcloud",
  version: "0.1.1",
  displayName: "Word clouds",
  manifest,
  server(host) {
    wordcloudStore.bind(createWordcloudStore(host.db));
    return { handler, routes: [{ path: "/wordcloud", router: routes }] };
  },
};

export default wordcloudPackage;
