// vote_results: the process type's manifest (src/processes/manifest.ts; ADR-009).
// Plain data: the registry, the wire, the settings page, the feed and the UI
// are built from it. The handler (./handler.ts) runs its actions.

import type { ProcessManifest } from "../../processes/manifest.js";
import type { ProcessTypeDescriptor } from "../../processes/descriptor.js";

/**
 * What a vote-results record is (src/processes/descriptor.ts). A legacy
 * record: votes stopped creating them when briefs became the one results
 * artifact (the vote's close, src/processes/types.ts generateBrief), but the
 * type stays registered for the records that exist and for their admin
 * routes (/admin/vote-results/*). It has no process actions: edit and approve
 * are those routes, and their events are listed in `emits` only. Approval
 * emails the board, then sets the row to finalized.
 *
 * Lifecycle: active (created, pending review) to finalized (published); never
 * closed.
 */
const descriptor: ProcessTypeDescriptor = {
  type: "civic.vote_results",
  version: "0.1",
  tier: 1,
  plugin: "vote",
  states: ["active", "finalized"],
  initial_status: "active",
  actions: [],
  emits: [
    "civic.process.aggregation_completed",
    "civic.process.outcome_recorded",
    "civic.process.result_published",
  ],
  creation: { resident: null, admin: false, system: false },
  deadline: null,
  brief: false,
  tables: [],
  outside_services: [],
  examples: {},
  // The pre-brief results record: an Outcome too, listed under Outcomes
  // (the brief's section, whose detail paths include /vote-results/).
  display: { label: "Outcome", plural: "Outcomes", icon: "outcome" },
};

export const VOTE_RESULTS_MANIFEST: ProcessManifest = {
  descriptor,
  color: "brief",
  detailPath: (id) => `/vote-results/${id}`,
  requiredSchema: [],
  tables: [],
  jobs: [],
  activities: {},
  publicListing: { field: "publication_status", equals: "published" },
};
