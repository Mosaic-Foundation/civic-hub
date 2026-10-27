// proposal: the process type's manifest (src/processes/manifest.ts; ADR-009).
// Plain data: the registry, the wire, the settings page, the feed and the UI
// are built from it. The handler (./handler.ts) runs its actions.

import { defineDescriptor, defineManifest } from "../../src/processes/manifest.js";
import { DEADLINE_CLOSE_INPUT } from "../../src/shared/deadlineClose.js";

/**
 * What a proposal is (src/processes/descriptor.ts). Residents support it, or
 * withdraw support, while it is open; it closes at its deadline (or when an
 * admin closes it) and its brief reports the support it drew.
 *
 * Its creation is announced as civic.proposal.submitted and its close as
 * civic.proposal.closed.
 */
const descriptor = defineDescriptor({
  type: "civic.proposal",
  version: "0.1",
  tier: 1,
  plugin: "proposal",
  states: ["active", "closed"],
  initial_status: "active",
  actions: [
    {
      name: "process.support",
      description: "Support an open proposal",
      callers: ["resident", "admin"],
      from: ["active"],
      to: null,
      emits: ["civic.proposal.supported"],
      once_per_participant: true,
      input_schema: { type: "object", properties: {}, examples: [{}] },
    },
    {
      name: "process.unsupport",
      description: "Withdraw support while the proposal is open",
      callers: ["resident", "admin"],
      from: ["active"],
      to: null,
      emits: ["civic.proposal.support_withdrawn"],
      input_schema: { type: "object", properties: {}, examples: [{}] },
    },
    {
      name: "process.close",
      description: "Close the proposal; its support is part of the record",
      callers: ["admin", "system"],
      from: ["active"],
      to: "closed",
      emits: ["civic.proposal.closed"],
      input_schema: DEADLINE_CLOSE_INPUT,
      // Its only other effect, the proposals row's copy of the status, is
      // written after the process row commits.
      retry_safe: true,
    },
  ],
  emits: [
    "civic.proposal.submitted",
    "civic.proposal.supported",
    "civic.proposal.support_withdrawn",
    "civic.proposal.closed",
  ],
  creation: { resident: { drafts: "/proposals/drafts" }, admin: false, system: false },
  deadline: { action: "process.close", source: "proposals.closes_at" },
  brief: true,
  tables: ["proposals", "proposal_supports", "proposal_drafts"],
  outside_services: [],
  examples: {
    draft: { title: "Conformance proposal", description: "An idea to gauge interest in.", category: "idea" },
  },
  display: {
    label: "Proposal",
    plural: "Proposals",
    icon: "proposal",
    section: { id: "proposals", label: "Proposals", path: "/propose", detail_paths: ["/proposal/"], order: 20 },
  },
});

export const PROPOSAL_MANIFEST = defineManifest({
  descriptor,
  color: "proposal",
  detailPath: (id) => `/proposal/${id}`,
  requiredSchema: [
    { table: "proposals", owner: "civic.proposals" },
    { table: "proposal_supports", owner: "civic.proposals" },
  ],
  tables: [
    { name: "proposals", rows: "export", key: ["id"], holds: "proposals" },
    { name: "proposal_supports", rows: "export", key: ["proposal_id", "user_id"], holds: "who supports each proposal" },
    { name: "proposal_drafts", rows: "export", key: ["id"], holds: "residents' unfinished proposal drafts" },
  ],
  jobs: [],
  pluginSection: {
 order: 20,
 name: "Proposals",
 what: "Ideas residents float for discussion and support.", fields: [] },
  activities: {
    "civic.proposal.submitted": { type: "Create", object: { kind: "civic", class: "civic:Proposal", id: "process", name: "title" } },
    // AS2's own verb for endorsement: no civic term needed (spec §3.1 rule 1).
    "civic.proposal.supported": { type: "Like", object: { kind: "civic", class: "civic:Proposal", id: "process" } },
    // Withdrawing support undoes the Like above.
    "civic.proposal.support_withdrawn": { type: "Undo", object: { kind: "civic", class: "civic:Proposal", id: "process" } },
    "civic.proposal.closed": { type: "civic:End", object: { kind: "process", terminalState: "closed" } },
  },
  legacyActivities: {
    // Its emitter exists (./events.ts) but nothing calls it;
    // mapped so the type stays serializable if the path is ever wired up.
    "civic.proposal.endorsed": { type: "Like", object: { kind: "civic", class: "civic:Proposal", id: "process" } },
  },
  // What hub:payload carries publicly, per event (Architecture 3, ADR-010).
  // Who a participant's name is disclosed to (Architecture 3, Q6: Adam, 2026-10-21).
  disclosure: "members",
  // What the hub's analytics counts (ADR-016).
  participation: {
    participation: ["civic.proposal.supported", "civic.proposal.support_withdrawn"],
    creation: ["civic.proposal.submitted"],
    closing: ["civic.proposal.closed"],
    outcome: [],
  },
  publicPayload: {
    "civic.proposal.submitted": ["proposal"],
    "civic.proposal.supported": ["proposal"],
    "civic.proposal.support_withdrawn": ["proposal"],
    "civic.proposal.closed": ["proposal", "closed_early"],
    "civic.proposal.endorsed": ["proposal"],
  },
  // What a closed proposal answers a support (civic.proposals).
  deadlineRefusal: { code: "proposal_not_open", message: "This proposal is no longer accepting support." },
  feed: {
    cards: [
      { event: "civic.proposal.submitted", match: "event", card: { surface: "activity", kind: "proposal", color: "proposal", pill: "New proposal", href: "detail" } },
      // civic.proposal.closed is deliberately not a card (Adam, 2026-08-26):
      // the published brief announces that a proposal concluded, as for votes
      // and conversations. The event is still on the wire.
    ],
    brief: { color: "proposal", noun: "proposal", pill: "Proposal results" },
  },
  capabilities: {
    activities: { emit: ["civic.proposal.submitted", "civic.proposal.supported", "civic.proposal.support_withdrawn", "civic.proposal.closed"], listen: [] },
    state: { read: ["own-process"], write: ["own-process"], tables: ["proposals", "proposal_supports", "proposal_drafts"] },
    adapters: [],
    network: { egress: [] },
    identity: { claims: ["participant-ref"] },
    ui: { surfaces: ["process-page", "create-page", "feed-card", "nav-section", "settings-panel"] },
  },
});

export default PROPOSAL_MANIFEST;
