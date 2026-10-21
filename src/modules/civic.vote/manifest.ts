// vote: the process type's manifest (src/processes/manifest.ts; ADR-009).
// Plain data: the registry, the wire, the settings page, the feed and the UI
// are built from it. The handler (./handler.ts) runs its actions.

import { defineDescriptor, defineManifest } from "../../processes/manifest.js";
import { DEADLINE_CLOSE_INPUT } from "../../shared/deadlineClose.js";

/**
 * What a vote is (src/processes/descriptor.ts). Residents support while it
 * gathers endorsements, then cast a ballot; propose, activate and close are
 * lifecycle control, an admin's or the hub's (an approval, a deadline).
 *
 * Retry-safe: propose, support, unsupport, activate and close change only the
 * vote's state and the events written with it, so on a conflict they run
 * again on a fresh read (two endorsements at once both count; a close that
 * lost to a ballot re-tallies with it). A ballot is not: cast_ballot writes
 * it, and the count, in its own transaction.
 *
 * An approval runs propose (or activate, for a vote configured for direct
 * activation) from pending_review, in the same transaction as the approval's
 * status change (src/modules/civic.review/service.ts).
 */
const descriptor = defineDescriptor({
  type: "civic.vote",
  version: "0.1",
  tier: 1,
  plugin: "vote",
  states: ["draft", "proposed", "threshold_met", "active", "closed", "finalized"],
  initial_status: "draft",
  actions: [
    {
      name: "process.propose",
      description: "Open the vote for community endorsements",
      callers: ["admin", "system"],
      from: ["draft", "pending_review"],
      to: "proposed",
      emits: ["civic.process.proposed"],
      retry_safe: true,
    },
    {
      name: "process.support",
      description: "Endorse a proposed vote; at the threshold it opens for ballots",
      callers: ["resident", "admin"],
      from: ["proposed"],
      to: ["proposed", "active"],
      emits: ["civic.process.threshold_met", "civic.process.started"],
      retry_safe: true,
      once_per_participant: true,
      input_schema: { type: "object", properties: {}, examples: [{}] },
    },
    {
      name: "process.unsupport",
      description: "Withdraw an endorsement before the threshold is met",
      callers: ["resident", "admin"],
      from: ["proposed"],
      to: null,
      emits: [],
      retry_safe: true,
      input_schema: { type: "object", properties: {}, examples: [{}] },
    },
    {
      name: "process.activate",
      description: "Open the voting window",
      callers: ["admin", "system"],
      from: ["draft", "threshold_met", "pending_review"],
      to: "active",
      emits: ["civic.process.started"],
      retry_safe: true,
    },
    {
      name: "process.vote",
      description: "Cast a ballot, or change one with its receipt",
      callers: ["resident", "admin"],
      from: ["active"],
      to: null,
      emits: ["civic.process.vote_submitted"],
      once_per_participant: true,
      input_schema: {
        type: "object",
        properties: {
          option: { type: "string" },
          selections: { type: "array", items: { type: "string" } },
          receipt: {
            type: "object",
            properties: { receipt_id: { type: "string" }, change_key: { type: "string" } },
          },
        },
        examples: [{ option: "yes" }],
      },
    },
    {
      name: "process.close",
      description: "End the voting window; the tally is published and the vote finalized",
      callers: ["admin", "system"],
      from: ["active"],
      to: "finalized",
      emits: [
        "civic.process.ended",
        "civic.process.aggregation_completed",
        "civic.process.result_published",
      ],
      retry_safe: true,
      input_schema: DEADLINE_CLOSE_INPUT,
    },
  ],
  emits: [
    "civic.process.proposed",
    "civic.process.threshold_met",
    "civic.process.started",
    "civic.process.vote_submitted",
    "civic.process.ended",
    "civic.process.aggregation_completed",
    "civic.process.result_published",
  ],
  creation: { resident: { drafts: "/votes/drafts" }, admin: true, system: false },
  deadline: { action: "process.close", source: "state.voting_closes_at" },
  brief: true,
  tables: ["vote_records", "vote_participation", "active_vote_keys", "vote_drafts"],
  outside_services: [],
  examples: {
    draft: { title: "Conformance vote", description: "Should the hub try this?" },
    create: {
      body: {
        definition: { type: "civic.vote", version: "0.1" },
        title: "Conformance vote",
        description: "Should the hub try this?",
        state: { config: { activation_mode: "direct" } },
      },
    },
  },
  display: {
    label: "Vote",
    plural: "Votes",
    icon: "vote",
    section: { id: "votes", label: "Votes", path: "/votes", detail_paths: ["/process/", "/votes/"], order: 30 },
  },
});

export const VOTE_MANIFEST = defineManifest({
  descriptor,
  color: "vote",
  detailPath: (id) => `/process/${id}`,
  // The two-table split below is the anonymous-ballot guarantee, not an
  // accident of normalization: vote_records knows the choice but not the
  // voter, vote_participation knows the voter but not the choice. The
  // forbidden columns are checked at startup so a future migration cannot
  // quietly join them back together.
  requiredSchema: [
    {
      table: "vote_records",
      // change_key_hash: the voter holds the receipt (20261010000000).
      columns: ["receipt_id", "process_id", "choice", "change_key_hash"],
      forbiddenColumns: [
        {
          column: "user_id",
          reason:
            "vote_records must never identify the voter — this column would make every past ballot attributable",
        },
      ],
      owner: "civic.vote",
    },
    {
      table: "vote_participation",
      columns: ["user_id", "process_id", "has_voted"],
      forbiddenColumns: [
        {
          column: "receipt_id",
          reason:
            "vote_participation must never link a voter to a ballot receipt",
        },
      ],
      owner: "civic.vote",
    },
    {
      // Retired 2026-10-10: only read and cleared (early voters collecting
      // a key; close). Drop this entry with the table.
      table: "active_vote_keys",
      columns: ["user_id", "process_id", "receipt_id"],
      owner: "civic.vote",
    },
  ],
  tables: [
    { name: "vote_records", rows: "export", key: ["receipt_id"] },
    { name: "vote_participation", rows: "export", key: ["user_id", "process_id"] },
    { name: "active_vote_keys", rows: "export", key: ["user_id", "process_id"] },
    { name: "vote_drafts", rows: "export", key: ["id"] },
  ],
  jobs: [],
  pluginSection: {
    order: 10,
    fields: [
      { key: "plugin.vote.min_duration_days", kind: "number", min: 1, max: 365 },
      { key: "plugin.vote.max_duration_days", kind: "number", min: 1, max: 365 },
      { key: "plugin.vote.default_duration_days", kind: "number", min: 1, max: 365 },
      { key: "plugin.vote.default_check_mode", kind: "choice", options: ["show_choice", "counted_only"] },
    ],
  },
  activities: {},
  // "Brief to the Supervisors" (Adam, 2026-10-07).
  briefPill: "to_board",
  // A ballot after the deadline, before the hourly close (the vote module's own words).
  deadlineRefusal: { code: "vote_closed", message: "Cannot submit vote: voting window has expired" },
  feed: {
    cards: [
      // Votes from before events carried data.process.type are the only
      // untyped civic.process.started there is.
      { event: "civic.process.started", untypedDefault: true, card: { surface: "activity", kind: "vote-open", color: "vote", pill: "Vote open", href: "action_url" } },
      // A vote's own results, published when it closes (since 2026-10-07: a
      // vote finishes on its own; its brief is separate and posts its own
      // card). Any other vote result_published is not a card: before
      // 2026-10-07 approving its brief announced the result.
      { event: "civic.process.result_published", when: { results_at_close: true }, card: { surface: "activity", kind: "vote-closed", color: "vote", pill: "Vote results", href: "action_url" } },
    ],
    // The vote posts its own "Vote results" card when it closes; its brief is
    // a separate post (2026-10-07).
    brief: { color: "vote", noun: "vote", pill: "Vote brief" },
  },
});
