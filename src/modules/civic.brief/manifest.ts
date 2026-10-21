// brief: the process type's manifest (src/processes/manifest.ts; ADR-009).
// Plain data: the registry, the wire, the settings page, the feed and the UI
// are built from it. The handler (./handler.ts) runs its actions.

import type { ProcessManifest } from "../../processes/manifest.js";
import type { ProcessTypeDescriptor } from "../../processes/descriptor.js";

/**
 * What a brief is (src/processes/descriptor.ts). The hub spawns one when a
 * process closes (spawnBriefFromClosedProcess); an admin reviews, edits and
 * approves it through /admin/briefs/*, and approval publishes it and sets the
 * row to finalized. It has no process actions. An official's response
 * (POST /brief/:id/respond, a different table's write) emits action_taken
 * outside any action.
 *
 * Lifecycle: active (pending review) to finalized (published); never closed.
 */
const descriptor: ProcessTypeDescriptor = {
  type: "civic.brief",
  version: "0.1",
  tier: 1,
  plugin: "brief",
  states: ["active", "finalized"],
  initial_status: "active",
  actions: [],
  emits: [
    "civic.process.aggregation_completed",
    "civic.process.outcome_recorded",
    "civic.process.result_published",
    "civic.process.action_taken",
  ],
  creation: { resident: null, admin: false, system: true },
  deadline: null,
  brief: false,
  tables: ["brief_responses"],
  outside_services: [],
  examples: {},
  // A brief is what a finished process produced: residents meet it as an
  // Outcome, and the Outcomes section lists them.
  display: {
    label: "Outcome",
    plural: "Outcomes",
    icon: "outcome",
    section: {
      id: "outcomes",
      label: "Outcomes",
      path: "/outcomes",
      detail_paths: ["/brief/", "/vote-results/"],
      order: 50,
    },
  },
};

export const BRIEF_MANIFEST: ProcessManifest = {
  descriptor,
  color: "brief",
  detailPath: (id) => `/brief/${id}`,
  requiredSchema: [],
  tables: [
    { name: "brief_responses", rows: "export", key: ["id"] },
  ],
  jobs: [],
  pluginSection: { order: 60, fields: [] },
  activities: {},
  publicListing: { field: "publication_status", equals: "published" },
};
