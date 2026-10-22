// meeting_summary: the process type's manifest (src/processes/manifest.ts; ADR-009).
// Plain data: the registry, the wire, the settings page, the feed and the UI
// are built from it. The handler (./handler.ts) runs its actions.

import { defineDescriptor, defineManifest } from "../../processes/manifest.js";
import { MEETING_CONNECTOR_OPTIONS } from "../../shared/connectorOptions.js";

/**
 * What a meeting summary is (src/processes/descriptor.ts). The meeting
 * summary job (/internal/meeting-summary/run) creates one pending review; an
 * admin edits and approves it through /admin/meeting-summaries/*, and
 * approval publishes it and sets the row to finalized. The job may also
 * publish one itself. It has no process actions. A revision staged on a
 * published summary stays on its state; the row stays finalized.
 *
 * Lifecycle: active (pending review) to finalized (published); never closed.
 */
const descriptor = defineDescriptor({
  type: "civic.meeting_summary",
  version: "0.1",
  tier: 1,
  plugin: "meeting_summary",
  states: ["active", "finalized"],
  initial_status: "active",
  actions: [],
  emits: [
    "civic.process.aggregation_completed",
    "civic.process.outcome_recorded",
    "civic.process.result_published",
  ],
  creation: { resident: null, admin: false, system: true },
  deadline: null,
  brief: false,
  tables: [],
  outside_services: [],
  examples: {},
  display: { label: "Meeting summary", plural: "Meeting summaries", icon: "meeting" },
});

export const MEETING_SUMMARY_MANIFEST = defineManifest({
  descriptor,
  color: "meeting",
  detailPath: (id) => `/meeting-summary/${id}`,
  requiredSchema: [],
  tables: [],
  jobs: [
    {
      id: "meeting_summary",
      plugin: "meeting_summary",
      path: "/meeting-summary/run",
      schedule: "30 11 * * *",
      description: "Meeting discovery and summarization, per hub that configured a source",
    },
  ],
  pluginSection: {
    order: 80,
    name: "Meeting summaries",
    what: "Plain-language summaries of public meetings, drafted for admin review.",
    fields: [
      { key: "plugin.meeting_summary.connector_id", kind: "choice", options: MEETING_CONNECTOR_OPTIONS },
      { key: "plugin.meeting_summary.source_url", kind: "url" },
      { key: "plugin.meeting_summary.youtube_channel_id", kind: "text", maxLength: 64 },
      { key: "plugin.meeting_summary.title_filter", kind: "text", maxLength: 300 },
      { key: "plugin.meeting_summary.type_exclude", kind: "text", maxLength: 300 },
      { key: "plugin.meeting_summary.cutoff_date", kind: "date" },
      { key: "plugin.meeting_summary.auto_publish", kind: "boolean" },
      { key: "plugin.meeting_summary.extraction_instructions", kind: "textarea", maxLength: 4000 },
      // Generic meeting summaries (the cleanup slice, 2026-10-16). Empty reads as
      // the defaults, which are what every hub had before.
      { key: "plugin.meeting_summary.wix_fields", kind: "wix_fields", maxLength: 300 },
      { key: "plugin.meeting_summary.record_grace_days", kind: "number", min: 1, max: 120 },
      { key: "plugin.meeting_summary.source_quiet_days", kind: "number", min: 7, max: 365 },
    ],
  },
  activities: {},
  // What hub:payload carries publicly, per event (Architecture 3, ADR-010):
  // everything a published summary's history already serves stays.
  publicPayload: {
    "civic.process.aggregation_completed": [
      "aggregation_method",
      "participant_count",
      "result_summary",
      "result_type",
      "block_count",
      "meeting_date",
    ],
    "civic.process.outcome_recorded": ["outcome_type", "outcome_description"],
    "civic.process.result_published": [
      "meeting_summary",
      "meeting_title",
      "meeting_date",
      "block_count",
      "source_minutes_url",
      "source_video_url",
      "summary_id",
    ],
    "civic.process.updated": ["meeting_summary"],
  },
  publication: { field: "approval_status", queue: "meeting_summaries" },
  feed: {
    cards: [
      {
        event: "civic.process.result_published",
        legacy: [{ field: "meeting_summary", is: "present" }, { field: "summary_id", is: "string" }],
        card: { surface: "meeting_summary", kind: "meeting", color: "meeting", pill: "Meeting summary", href: "action_url" },
      },
    ],
  },
});
