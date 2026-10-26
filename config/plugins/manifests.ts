// Written by `npm run plugins:sync` from config/plugins.json. Do not edit.
// Every configured package's manifest, in load order: plain data the server and the UI both read.

import m0 from "../../packages/civic.wordcloud/manifest.js";

export const PACKAGE_MANIFESTS = [m0] as const;

/** Each configured package's directory and name, beside its manifest. */
export const PACKAGE_ENTRIES = [
  { dir: "packages/civic.wordcloud", name: "@civic-social/plugin-wordcloud", manifest: m0 },
] as const;
