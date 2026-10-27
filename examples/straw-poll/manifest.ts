// The straw poll's manifest: what the type is, as plain data the hub's server
// and its UI both read. docs/BUILD-A-PLUGIN.md walks through every field.

import { DEADLINE_CLOSE_INPUT, defineDescriptor, defineManifest } from "@civic-social/plugin-sdk/manifest";

export const TYPE = "example.straw_poll";

/**
 * A straw poll: one question, two to six options, one answer per resident,
 * closing at a date (or earlier, by an admin, with a note). An admin creates
 * it, live at once. Its answers are kept in its own table; only the counts
 * are ever published.
 */
const descriptor = defineDescriptor({
  type: TYPE,
  version: "0.1",
  tier: 1,
  plugin: "straw_poll",
  states: ["active", "closed"],
  initial_status: "active",
  actions: [
    {
      name: "answer",
      description: "Answer the poll: one of its options, once",
      callers: ["resident", "admin"],
      from: ["active"],
      to: null,
      emits: ["civic.process.submission_received"],
      once_per_participant: true,
      input_schema: {
        type: "object",
        properties: { choice: { type: "string" } },
        required: ["choice"],
        examples: [{ choice: "Yes" }],
      },
    },
    {
      name: "close",
      description: "Close the poll and publish the counts",
      callers: ["admin", "system"],
      from: ["active"],
      to: "closed",
      emits: ["civic.process.ended", "civic.process.result_published"],
      retry_safe: true,
      input_schema: DEADLINE_CLOSE_INPUT,
    },
  ],
  emits: ["civic.process.submission_received", "civic.process.ended", "civic.process.result_published"],
  creation: { resident: null, admin: true, system: false },
  deadline: { action: "close", source: "state.closes_at" },
  brief: false,
  tables: ["straw_poll_answers"],
  outside_services: [],
  examples: {
    create: {
      body: {
        definition: { type: TYPE, version: "0.1" },
        title: "Conformance straw poll",
        description: "A quick question.",
        state: { question: "Should the hub try this?", options: ["Yes", "No"], duration_days: 7 },
      },
    },
  },
  display: { label: "Straw poll", plural: "Straw polls", icon: "poll" },
});

export const STRAW_POLL_MANIFEST = defineManifest({
  descriptor,
  color: "vote",
  detailPath: (id) => `/straw-poll/${id}`,
  requiredSchema: [{ table: "straw_poll_answers", columns: ["process_id", "user_id", "choice"], owner: TYPE }],
  tables: [{ name: "straw_poll_answers", rows: "export", key: ["process_id", "user_id"], holds: "residents' answers to straw polls, one each" }],
  jobs: [],
  pluginSection: { order: 70, name: "Straw polls", what: "A quick one-question poll that closes on a date.", fields: [] },
  activities: {},
  // Who a participant's name is shown to: nobody. Answers are counted, never listed.
  disclosure: "anonymous",
  // What the hub's analytics counts (ADR-016; docs/BUILD-A-PLUGIN.md): an
  // answer is a resident taking part.
  participation: {
    participation: ["civic.process.submission_received"],
    creation: ["civic.process.created"],
    closing: ["civic.process.ended"],
    outcome: ["civic.process.result_published"],
  },
  // What the public record carries, per event: the counts, when the poll closes.
  publicPayload: { "civic.process.result_published": ["straw_poll_result"] },
  deadlineRefusal: { code: "straw_poll_closed", message: "This straw poll has closed." },
  capabilities: {
    activities: { emit: ["civic.process.submission_received", "civic.process.ended", "civic.process.result_published"], listen: [] },
    state: { read: ["own-process"], write: ["own-process"], tables: ["straw_poll_answers"] },
    adapters: [],
    network: { egress: [] },
    identity: { claims: ["participant-ref"] },
    ui: { surfaces: ["process-page"] },
  },
});

export default STRAW_POLL_MANIFEST;
