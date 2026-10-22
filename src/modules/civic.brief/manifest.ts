// brief: the process type's manifest (src/processes/manifest.ts; ADR-009).
// Plain data: the registry, the wire, the settings page, the feed and the UI
// are built from it. The handler (./handler.ts) runs its actions.

import { defineDescriptor, defineManifest } from "../../processes/manifest.js";

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
const descriptor = defineDescriptor({
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
    name: "Brief",
    icon: "outcome",
    section: {
      id: "outcomes",
      label: "Outcomes",
      path: "/outcomes",
      detail_paths: ["/brief/", "/vote-results/"],
      order: 50,
    },
  },
});

export const BRIEF_MANIFEST = defineManifest({
  descriptor,
  color: "brief",
  detailPath: (id) => `/brief/${id}`,
  requiredSchema: [],
  tables: [
    { name: "brief_responses", rows: "export", key: ["id"] },
  ],
  jobs: [],
  pluginSection: {
 order: 60,
 name: "Briefs",
 what: "The published record of what residents decided, sent to officials.", fields: [] },
  activities: {},
  // What hub:payload carries publicly, per event (Architecture 3, ADR-010).
  // Dropped deliberately, with Adam's field-row yes (2026-10-21): the review
  // workflow's publication_status on updated (row 1) and the delivery
  // bookkeeping delivered_to_count on outcome_recorded (row 2).
  // Who a participant's name is disclosed to (Architecture 3, Q6: Adam, 2026-10-21).
  disclosure: "public",
  publicPayload: {
    "civic.process.created": ["source_process_id", "source_process_type"],
    "civic.process.aggregation_completed": ["source_process_id", "participation_count"],
    "civic.process.outcome_recorded": ["source_process_id"],
    "civic.process.result_published": ["brief", "result_of"],
    // The official's on-the-record response to a published brief.
    "civic.process.action_taken": ["action", "feed_anchor", "brief", "response"],
  },
  // /brief/:id answers 404 for an unpublished brief, admins included: the
  // admin reaches one through the Briefs tab (Adam, 2026-09-06).
  publication: { field: "publication_status", queue: "briefs", linkedBeforePublished: false },
  summarizes: { stateField: "source_process_id" },
  feed: {
    cards: [
      // The final result of any closed process; it wears its source's colour and pill.
      { event: "civic.process.result_published", card: "brief" },
      // An official's public response to a published brief. Every response
      // emits this event (the log is never throttled), but only the ANCHOR,
      // stamped by the write path when no other response to the same brief
      // anchored a card in the last 24h, renders, so a burst of responses is
      // one card; the brief's page shows them all.
      {
        event: "civic.process.action_taken",
        when: { action: "official_response", feed_anchor: true },
        card: { surface: "activity", kind: "brief-response", color: "official-response", pill: "Official response", href: "detail" },
      },
    ],
  },
});
