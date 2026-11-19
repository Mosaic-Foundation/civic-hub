// meeting_summary: the process type's manifest (src/processes/manifest.ts; ADR-009).
// Plain data: the registry, the wire, the settings page, the feed and the UI
// are built from it. The handler (./handler.ts) runs its actions.

import { defineDescriptor, defineManifest } from "@civic-social/plugin-sdk/manifest";
import { MEETING_CONNECTOR_OPTIONS } from "./connectors/options.js";

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
  // Its colours' defaults (kernel step 4: each plugin carries its own). The
  // Civic Hub's palette lists the same keys (a few following its base colours), and wins.
  colors: [
    { key: "meeting", label: "Meeting summaries", fg: "#2a7340", bg: "#dceedf", dark: { fg: "#7cc790", bg: "#1f2a22" }, email: { fg: "#0f4a26", bg: "#d9ecd9" } },
  ],
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
      {
        key: "plugin.meeting_summary.connector_id", kind: "choice", options: MEETING_CONNECTOR_OPTIONS,
        help: { text: "Where the hub looks for meetings: automatic (the default), or one source such as a site collection, an agendas and minutes page or a YouTube channel.", page: "/reference/plugins", anchor: "plugin-meeting-summary-connector-id" },
      },
      {
        key: "plugin.meeting_summary.source_url", kind: "url",
        help: { text: "Your government's agendas and minutes page, used to find meetings. Without a source, this hub's meetings are not summarized.", page: "/reference/plugins", anchor: "plugin-meeting-summary-source-url" },
      },
      {
        key: "plugin.meeting_summary.youtube_channel_id", kind: "text", maxLength: 64,
        help: { text: "For meetings published as videos: the channel's ID, which starts with UC. Used when the source is a YouTube channel.", page: "/reference/plugins", anchor: "plugin-meeting-summary-youtube-channel-id" },
      },
      {
        key: "plugin.meeting_summary.title_filter", kind: "text", maxLength: 300,
        help: { text: "Comma-separated words a meeting's title must contain to be summarized. Left empty, every meeting found is taken.", page: "/reference/plugins", anchor: "plugin-meeting-summary-title-filter" },
      },
      {
        key: "plugin.meeting_summary.type_exclude", kind: "text", maxLength: 300,
        help: { text: "Comma-separated words that skip a meeting when its title contains one, such as a board this hub does not cover. Left empty, none are skipped.", page: "/reference/plugins", anchor: "plugin-meeting-summary-type-exclude" },
      },
      {
        key: "plugin.meeting_summary.cutoff_date", kind: "date",
        help: { text: "Meetings before this date are ignored. Left empty, every meeting found is summarized.", page: "/reference/plugins", anchor: "plugin-meeting-summary-cutoff-date" },
      },
      {
        key: "plugin.meeting_summary.auto_publish", kind: "boolean",
        help: { text: "When on, summaries publish without waiting for an admin, though one the hub flags for a problem still waits. Off by default: each summary waits for review.", page: "/reference/plugins", anchor: "plugin-meeting-summary-auto-publish" },
      },
      {
        key: "plugin.meeting_summary.extraction_instructions", kind: "textarea", maxLength: 4000,
        help: { text: "Optional extra instructions for the summarizer, such as which topics people care about most. They are added to the standard instructions.", page: "/reference/plugins", anchor: "plugin-meeting-summary-extraction-instructions" },
      },
      // Generic meeting summaries (the cleanup slice, 2026-10-16). Empty reads as
      // the defaults, which are what every hub had before.
      {
        key: "plugin.meeting_summary.wix_fields", kind: "wix_fields", maxLength: 300,
        help: { text: "For a Wix site only: which collection columns hold the date, type, agenda, minutes and recordings, as role=column pairs. Empty uses the usual columns.", page: "/reference/plugins", anchor: "plugin-meeting-summary-wix-fields" },
      },
      {
        key: "plugin.meeting_summary.record_grace_days", kind: "number", min: 1, max: 120,
        help: { text: "How many days a listed meeting may wait for its minutes or transcript before the admins are told something may be wrong. Empty means 14.", page: "/reference/plugins", anchor: "plugin-meeting-summary-record-grace-days" },
      },
      {
        key: "plugin.meeting_summary.source_quiet_days", kind: "number", min: 7, max: 365,
        help: { text: "How many days without a new meeting before the run asks an admin to check the source still works. Empty means 45; set it longer for a body that meets less often.", page: "/reference/plugins", anchor: "plugin-meeting-summary-source-quiet-days" },
      },
    ],
    words: ["meetings", "minutes", "agendas", "council meetings", "ai summaries", "recordings"],
    help: { text: "Plain-language summaries of public meetings, drafted by AI once a day for admin review. A hub with no meeting source set is skipped.", page: "/reference/plugins", anchor: "plugins-meeting-summary" },
    // "Needs setup" until it has a source (src/shared/pluginSetup.ts): what
    // the meeting-summary job reads, a page to read or a YouTube channel. Its
    // public part shows once a summary the public can see exists.
    setup: {
      keys: ["plugin.meeting_summary.source_url", "plugin.meeting_summary.youtube_channel_id"],
      configured: (s) =>
        !!s("plugin.meeting_summary.source_url")?.trim() || !!s("plugin.meeting_summary.youtube_channel_id")?.trim(),
      contentType: "civic.meeting_summary",
      missing: "Add a meeting source (a page address or a YouTube channel) below.",
    },
    search: {
      "plugin.meeting_summary.connector_id": { label: "Where meetings come from", words: ["source", "connector", "wix", "youtube", "agenda site"] },
      "plugin.meeting_summary.source_url": { label: "Meetings page", words: ["agenda page", "minutes page", "url", "website"] },
      "plugin.meeting_summary.youtube_channel_id": { label: "YouTube channel ID", words: ["youtube", "video", "recordings", "channel"] },
      "plugin.meeting_summary.title_filter": { label: "Only meetings whose title contains", words: ["filter", "include meetings"] },
      "plugin.meeting_summary.type_exclude": { label: "Skip meetings whose title contains", words: ["exclude", "skip", "ignore meetings"] },
      "plugin.meeting_summary.cutoff_date": { label: "Ignore meetings before", words: ["start date", "cutoff", "older meetings"] },
      "plugin.meeting_summary.auto_publish": { label: "Publish summaries without review", words: ["auto publish", "automatic", "skip review", "review summaries"] },
      "plugin.meeting_summary.extraction_instructions": { label: "Extra instructions for the summarizer", words: ["ai instructions", "prompt", "summarizer", "summariser"] },
      "plugin.meeting_summary.wix_fields": { label: "Wix collection columns", words: ["wix", "columns", "fields", "mapping"] },
      "plugin.meeting_summary.record_grace_days": { label: "Wait for a meeting's record", words: ["grace", "wait", "delay", "days"] },
      "plugin.meeting_summary.source_quiet_days": { label: "Ask for a check after no new meeting for", words: ["quiet", "stale", "no new meetings", "alert"] },
    },
  },
  activities: {},
  // What hub:payload carries publicly, per event (Architecture 3, ADR-010):
  // everything a published summary's history already serves stays.
  // Who a participant's name is disclosed to (Architecture 3, Q6: Adam, 2026-10-21).
  disclosure: "public",
  // What the hub's analytics counts (ADR-016): a public meeting recorded.
  // Nobody's attendance is recorded.
  participation: {
    participation: "none",
    creation: ["civic.process.created"],
    closing: [],
    outcome: ["civic.process.result_published"],
    measures: { met_in_public: "outcome" },
  },
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
  capabilities: {
    activities: { emit: ["civic.process.aggregation_completed", "civic.process.outcome_recorded", "civic.process.result_published"], listen: [] },
    state: { read: ["own-process"], write: ["own-process"], tables: [] },
    adapters: ["ai", "mail", "video", "web"],
    network: { egress: [] },
    identity: { claims: ["participant-ref"] },
    ui: { surfaces: ["process-page", "feed-card", "settings-panel"] },
  },
});

export default MEETING_SUMMARY_MANIFEST;
