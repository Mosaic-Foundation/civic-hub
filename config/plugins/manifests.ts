// Written by `npm run plugins:sync` from config/plugins.json. Do not edit.
// Every configured package's manifest, in load order: plain data the server and the UI both read.

import m0 from "../../packages/civic.vote/manifest.js";
import m1 from "../../packages/civic.proposals/manifest.js";
import m2 from "../../packages/civic.projects/manifest.js";
import m3 from "../../packages/civic.vote_results/manifest.js";
import m4 from "../../packages/civic.wordcloud/manifest.js";

export const PACKAGE_MANIFESTS = [m0, m1, m2, m3, m4] as const;

/** Each configured package's directory and name, beside its manifest. */
export const PACKAGE_ENTRIES = [
  { dir: "packages/civic.vote", name: "@civic-social/plugin-vote", manifest: m0 },
  { dir: "packages/civic.proposals", name: "@civic-social/plugin-proposal", manifest: m1 },
  { dir: "packages/civic.projects", name: "@civic-social/plugin-project", manifest: m2 },
  { dir: "packages/civic.vote_results", name: "@civic-social/plugin-vote-results", manifest: m3 },
  { dir: "packages/civic.wordcloud", name: "@civic-social/plugin-wordcloud", manifest: m4 },
] as const;
