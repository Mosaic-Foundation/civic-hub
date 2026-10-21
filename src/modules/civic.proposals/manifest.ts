// proposal: the process type's manifest (src/processes/manifest.ts; ADR-009).
// Plain data: the registry, the wire, the settings page, the feed and the UI
// are built from it. The handler (./handler.ts) runs its actions.

import { defineDescriptor, defineManifest } from "../../processes/manifest.js";
import { DEADLINE_CLOSE_INPUT } from "../../shared/deadlineClose.js";

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
    { name: "proposals", rows: "export", key: ["id"] },
    { name: "proposal_supports", rows: "export", key: ["proposal_id", "user_id"] },
    { name: "proposal_drafts", rows: "export", key: ["id"] },
  ],
  jobs: [],
  pluginSection: { order: 20, fields: [] },
  activities: {
    "civic.proposal.submitted": { type: "Create", object: { kind: "civic", class: "civic:Proposal", id: "process", name: "title" } },
    // AS2's own verb for endorsement: no civic term needed (spec §3.1 rule 1).
    "civic.proposal.supported": { type: "Like", object: { kind: "civic", class: "civic:Proposal", id: "process" } },
    // Withdrawing support undoes the Like above.
    "civic.proposal.support_withdrawn": { type: "Undo", object: { kind: "civic", class: "civic:Proposal", id: "process" } },
    "civic.proposal.closed": { type: "civic:End", object: { kind: "process", terminalState: "closed" } },
  },
  legacyActivities: {
    // Its emitter exists (civic.proposals/events.ts) but nothing calls it;
    // mapped so the type stays serializable if the path is ever wired up.
    "civic.proposal.endorsed": { type: "Like", object: { kind: "civic", class: "civic:Proposal", id: "process" } },
  },
  publicListing: "always",
});
