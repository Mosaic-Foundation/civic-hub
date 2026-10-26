// Written by `npm run plugins:sync` from config/plugins.json. Do not edit.
// Every configured package's server entry, in load order, for src/plugins/loader.ts.

import type { ConfiguredPackage } from "../../src/plugins/package.js";
import p0 from "../../packages/civic.vote/index.js";
import p1 from "../../packages/civic.proposals/index.js";
import p2 from "../../packages/civic.projects/index.js";
import p3 from "../../packages/civic.vote_results/index.js";
import p4 from "../../packages/civic.brief/index.js";
import p5 from "../../packages/civic.announcement/index.js";
import p6 from "../../packages/civic.wordcloud/index.js";

export const CONFIGURED_PACKAGES: readonly ConfiguredPackage[] = [
  { dir: "packages/civic.vote", pkg: p0 },
  { dir: "packages/civic.proposals", pkg: p1 },
  { dir: "packages/civic.projects", pkg: p2 },
  { dir: "packages/civic.vote_results", pkg: p3 },
  { dir: "packages/civic.brief", pkg: p4 },
  { dir: "packages/civic.announcement", pkg: p5 },
  { dir: "packages/civic.wordcloud", pkg: p6 },
];
