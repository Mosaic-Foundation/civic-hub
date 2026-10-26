// Written by `npm run plugins:sync` from config/plugins.json. Do not edit.
// Every configured package's server entry, in load order, for src/plugins/loader.ts.

import type { ConfiguredPackage } from "../../src/plugins/package.js";
import p0 from "../../packages/civic.wordcloud/index.js";

export const CONFIGURED_PACKAGES: readonly ConfiguredPackage[] = [
  { dir: "packages/civic.wordcloud", pkg: p0 },
];
