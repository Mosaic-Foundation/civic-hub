// wordcloud: the process type's manifest (src/processes/manifest.ts; ADR-009).
// Plain data: the registry, the wire, the settings page, the feed and the UI
// are built from it. The handler (./handler.ts) runs its actions.

import { defineDescriptor, defineManifest } from "../../processes/manifest.js";

/**
 * What a word cloud is (src/processes/descriptor.ts). Residents submit one
 * short answer per prompt while it is active; activate, snapshot and close
 * are an admin's. Neither a deadline nor a brief: an evergreen cloud stays
 * active until an admin closes it.
 *
 * Retry-safe: activate, snapshot and close change only the process row and
 * their events (snapshot and close only read the submissions table). A
 * submission is not: it writes a row of its own.
 *
 * The word cloud keeps a copy of its status on state, synced with the row.
 *
 * Lifecycle: draft, active, closed; it stops at closed.
 */
const descriptor = defineDescriptor({
  type: "civic.wordcloud",
  version: "0.1",
  tier: 1,
  plugin: "wordcloud",
  states: ["draft", "active", "closed"],
  initial_status: "draft",
  actions: [
    {
      name: "process.activate",
      description: "Open the word cloud for submissions",
      callers: ["admin"],
      from: ["draft"],
      to: "active",
      emits: ["civic.process.started"],
      retry_safe: true,
    },
    {
      name: "process.submit",
      description: "Submit a short answer to one of the prompts",
      callers: ["resident", "admin"],
      from: ["active"],
      to: null,
      emits: ["civic.process.submission_received"],
      once_per_participant: true,
      input_schema: {
        type: "object",
        properties: {
          prompt_id: { type: "string" },
          text: { type: "string" },
          device_token: { type: "string" },
        },
        required: ["prompt_id", "text"],
        examples: [{ prompt_id: "prompt_1", text: "parks" }],
      },
    },
    {
      name: "process.snapshot",
      description: "Publish a point-in-time snapshot of the cloud",
      callers: ["admin"],
      from: ["active"],
      to: null,
      emits: ["civic.process.result_published"],
      retry_safe: true,
    },
    {
      name: "process.close",
      description: "Close submissions and publish the final cloud",
      callers: ["admin"],
      from: ["active"],
      to: "closed",
      emits: ["civic.process.ended", "civic.process.result_published"],
      retry_safe: true,
    },
  ],
  emits: [
    "civic.process.started",
    "civic.process.submission_received",
    "civic.process.result_published",
    "civic.process.ended",
  ],
  creation: { resident: null, admin: true, system: false },
  deadline: null,
  brief: false,
  tables: ["wordcloud_submissions"],
  outside_services: [],
  examples: {
    create: {
      body: {
        definition: { type: "civic.wordcloud", version: "0.1" },
        title: "Conformance word cloud",
        description: "One word.",
        state: { prompts: [{ id: "p1", text: "One word?" }] },
      },
    },
  },
  display: { label: "Word cloud", plural: "Word clouds", icon: "wordcloud" },
});

export const WORDCLOUD_MANIFEST = defineManifest({
  descriptor,
  color: "wordcloud",
  detailPath: (id) => `/wordcloud/${id}`,
  requiredSchema: [
    {
      table: "wordcloud_submissions",
      columns: ["id", "process_id", "prompt_id", "author_id", "body"],
      owner: "civic.wordcloud",
    },
  ],
  tables: [
    { name: "wordcloud_submissions", rows: "export", key: ["id"] },
  ],
  jobs: [],
  pluginSection: {
    order: 50,
    name: "Word clouds",
    what: "One-word answers gathered into a cloud.",
    fields: [{ key: "plugin.wordcloud.onboarding_id", kind: "process", processType: "civic.wordcloud" }],
  },
  activities: {},
  // What hub:payload carries publicly, per event (Architecture 3, ADR-010).
  // Submissions are restricted and never reach the member/public wire; the
  // published snapshots and result are the public record.
  publicPayload: {
    "civic.process.result_published": ["wordcloud_result", "wordcloud_snapshot"],
  },
  feed: {
    cards: [
      {
        event: "civic.process.started",
        legacy: [{ field: "wordcloud_snapshot", is: "present" }, { field: "wordcloud_result", is: "present" }],
        card: { surface: "activity", kind: "wordcloud", color: "wordcloud", pill: "Word cloud", href: "detail" },
      },
      {
        event: "civic.process.result_published",
        legacy: [{ field: "wordcloud_snapshot", is: "present" }, { field: "wordcloud_result", is: "present" }],
        card: { surface: "activity", kind: "wordcloud", color: "wordcloud", pill: "Word cloud", href: "detail" },
      },
    ],
    brief: { color: "wordcloud" },
  },
});
