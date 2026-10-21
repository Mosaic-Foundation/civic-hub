// Every process type this hub software carries, as its manifest
// (src/processes/manifest.ts; ADR-009). The one list of types: the server's
// registry pairs each with its handler and checks it at startup, and the UI
// reads the same list for labels, colours and the feed. Order is the
// registry's (it decides nothing a resident sees; sections carry their own).
//
// Adding a type: its folder (manifest.ts + handler.ts), and one line here and
// one in src/processes/registry.ts's handler list. Loading types from packages
// is the plugin program's (ADR-009, "left for later").

import { VOTE_MANIFEST } from "../modules/civic.vote/manifest.js";
import { PROPOSAL_MANIFEST } from "../modules/civic.proposals/manifest.js";
import { PROJECT_MANIFEST } from "../modules/civic.projects/manifest.js";
import { VOTE_RESULTS_MANIFEST } from "../modules/civic.vote_results/manifest.js";
import { BRIEF_MANIFEST } from "../modules/civic.brief/manifest.js";
import { ANNOUNCEMENT_MANIFEST } from "../modules/civic.announcement/manifest.js";
import { MEETING_SUMMARY_MANIFEST } from "../modules/civic.meeting_summary/manifest.js";
import { POLIS_DELIBERATION_MANIFEST } from "./polis_deliberation/manifest.js";
import { WORDCLOUD_MANIFEST } from "../modules/civic.wordcloud/manifest.js";
import type { ProcessManifest } from "../processes/manifest.js";

export const PROCESS_MANIFESTS: readonly ProcessManifest[] = [
  VOTE_MANIFEST,
  PROPOSAL_MANIFEST,
  PROJECT_MANIFEST,
  VOTE_RESULTS_MANIFEST,
  BRIEF_MANIFEST,
  ANNOUNCEMENT_MANIFEST,
  MEETING_SUMMARY_MANIFEST,
  POLIS_DELIBERATION_MANIFEST,
  WORDCLOUD_MANIFEST,
];
