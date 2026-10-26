// Every process type this hub software carries, as its manifest
// (src/processes/manifest.ts; ADR-009). The one list of types: the server's
// registry pairs each with its handler and checks it at startup, and the UI
// reads the same list for labels, colours and the feed. Order is the
// registry's (it decides nothing a resident sees; sections carry their own).
//
// The types are plugin packages (ADR-014): the configured list
// (config/plugins.json, written out by `npm run plugins:sync` as
// config/plugins/manifests.ts) supplies their manifests, after the types not
// yet moved into packages. Adding a type is adding a package and a line in
// config/plugins.json.

import { VOTE_MANIFEST } from "../modules/civic.vote/manifest.js";
import { PROPOSAL_MANIFEST } from "../modules/civic.proposals/manifest.js";
import { PROJECT_MANIFEST } from "../modules/civic.projects/manifest.js";
import { VOTE_RESULTS_MANIFEST } from "../modules/civic.vote_results/manifest.js";
import { BRIEF_MANIFEST } from "../modules/civic.brief/manifest.js";
import { ANNOUNCEMENT_MANIFEST } from "../modules/civic.announcement/manifest.js";
import { MEETING_SUMMARY_MANIFEST } from "../modules/civic.meeting_summary/manifest.js";
import { POLIS_DELIBERATION_MANIFEST } from "./polis_deliberation/manifest.js";
import { PACKAGE_MANIFESTS } from "../../config/plugins/manifests.js";
import type { ProcessManifest } from "../processes/manifest.js";

export const PROCESS_MANIFESTS = [
  VOTE_MANIFEST,
  PROPOSAL_MANIFEST,
  PROJECT_MANIFEST,
  VOTE_RESULTS_MANIFEST,
  BRIEF_MANIFEST,
  ANNOUNCEMENT_MANIFEST,
  MEETING_SUMMARY_MANIFEST,
  POLIS_DELIBERATION_MANIFEST,
  ...PACKAGE_MANIFESTS,
] as const;

/** The same list, each as a plain ProcessManifest (for reading fields every manifest has). */
export const MANIFEST_LIST: readonly ProcessManifest[] = PROCESS_MANIFESTS;

/** Every process plugin id: the plugin each manifest's type belongs to. */
export type ProcessPluginId = (typeof PROCESS_MANIFESTS)[number]["descriptor"]["plugin"];

/** Every table a process type owns, by name. */
export type ProcessTableName = (typeof PROCESS_MANIFESTS)[number]["tables"][number]["name"];
