// vote_results: the process type's manifest (src/processes/manifest.ts; ADR-009).
// Plain data: the registry, the wire, the settings page, the feed and the UI
// are built from it. The handler (./handler.ts) runs its actions.

import { defineDescriptor, defineManifest } from "../../processes/manifest.js";

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
const descriptor = defineDescriptor({
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
  display: { label: "Outcome", plural: "Outcomes", name: "Vote results", icon: "outcome" },
});

export const VOTE_RESULTS_MANIFEST = defineManifest({
  descriptor,
  color: "brief",
  detailPath: (id) => `/vote-results/${id}`,
  requiredSchema: [],
  tables: [],
  jobs: [],
  activities: {},
  // What hub:payload carries publicly, per event (Architecture 3, ADR-010).
  // Dropped deliberately, with Adam's field-row yes (2026-10-21, row 7): the
  // internal results_id on result_published.
  // Who a participant's name is disclosed to (Architecture 3, Q6: Adam, 2026-10-21).
  disclosure: "public",
  publicPayload: {
    "civic.process.result_published": [
      "headline_result",
      "participation_count",
      "source_process_id",
    ],
    "civic.process.outcome_recorded": [
      "outcome_type",
      "outcome_description",
      "linked_process_id",
    ],
  },
  publication: { field: "publication_status", queue: "briefs" },
  feed: {
    cards: [
      {
        event: "civic.process.result_published",
        legacy: [{ field: "results_id", is: "string" }, { field: "brief_id", is: "string" }],
        card: { surface: "activity", kind: "vote-results", color: "vote", pill: "Vote results", href: "action_url" },
      },
    ],
  },
  capabilities: {
    activities: { emit: ["civic.process.aggregation_completed", "civic.process.outcome_recorded", "civic.process.result_published"], listen: [] },
    state: { read: ["own-process"], write: ["own-process"], tables: [] },
    adapters: ["mail"],
    network: { egress: [] },
    identity: { claims: ["participant-ref"] },
    ui: { surfaces: ["process-page", "feed-card"] },
  },
});
