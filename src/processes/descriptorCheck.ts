// The static half of plugin conformance: is a type's descriptor well formed,
// and does it agree with its handler and with the hub's own lists?
//
// Pure (no database, no request): run by tests/unit/processDescriptors.test.ts
// for every registered type, and by the conformance runner
// (tests/conformance/runConformance.ts) before it walks a type, so a third
// party's plugin gets the same checks as ours. Each problem is one sentence
// naming the type and what to declare or fix.

import {
  HOST_EVENT_TYPES,
  HOST_STATES,
  allowedTargets,
  type ProcessTypeDescriptor,
} from "./descriptor.js";
import type { ProcessHandler } from "./types.js";
import type { ProcessStatus } from "../models/process.js";

/** Every status a process row may hold (src/models/process.ts). */
export const PROCESS_STATUSES: readonly ProcessStatus[] = [
  "draft",
  "proposed",
  "threshold_met",
  "active",
  "closed",
  "finalized",
  "pending_review",
  "archived",
];

/** What the hub knows that a descriptor is checked against. */
export interface HostFacts {
  /** Every plugin id (src/models/hubSettings.ts PLUGIN_IDS). */
  pluginIds: readonly string[];
  /** Every event type the activity serializer maps (activitySerializer.mappedEventTypes()). */
  mappedEventTypes: readonly string[];
  /** Tables under forced row-level security (src/db/forHub.ts HUB_TABLES). */
  hubTables: readonly string[];
  /** Tables the hub export lists (src/db/schemaContract.ts EXPORT_MANIFEST). */
  exportManifest: readonly string[];
  /** The drafting kinds: which type each makes, and its table (src/processes/draftKinds.ts). */
  draftKinds: ReadonlyArray<{ processType: string; table: string }>;
}

/** Problems with one type's descriptor; empty when it conforms. */
export function checkDescriptor(handler: ProcessHandler, host: HostFacts): string[] {
  const d: ProcessTypeDescriptor | undefined = handler.descriptor;
  const t = handler.type;
  if (!d) return [`${t}: declares no descriptor (ProcessHandler.descriptor)`];
  const problems: string[] = [];
  const add = (p: string) => problems.push(`${t}: ${p}`);

  // Identity and manifest fields.
  if (d.type !== t) add(`descriptor.type is ${d.type}; the handler is ${t}`);
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(d.type)) add(`type must be reverse-namespace (vendor.name)`);
  if (!host.pluginIds.includes(d.plugin)) add(`plugin ${d.plugin} is not a plugin id`);
  if (d.tier === 2) add(`declares tier 2 (sandboxed); no sandbox runtime exists yet, so it cannot run here`);
  if (d.tier === 3 && d.outside_services.length === 0) add(`is tier 3 but declares no outside service`);
  if (d.tier === 1 && d.outside_services.length > 0) add(`is tier 1 but declares an outside service`);
  for (const svc of d.outside_services) {
    if (svc.data_retained.length === 0 || !svc.export_path.trim()) {
      add(`outside service ${svc.name} does not declare what data it keeps and how it leaves (§10a.7)`);
    }
    if (svc.participation.length === 0) add(`outside service ${svc.name} declares no participation routes`);
  }

  // States and transitions.
  const states = new Set<ProcessStatus>(d.states);
  if (d.states.length === 0) add(`declares no states`);
  for (const s of d.states) {
    if (!PROCESS_STATUSES.includes(s)) add(`state ${s} is not a process status`);
    if (HOST_STATES.includes(s)) add(`state ${s} is the hub's (pending_review, archived); leave it out`);
  }
  if (!states.has(d.initial_status)) add(`initial_status ${d.initial_status} is not one of its states`);
  const reachable = new Set<ProcessStatus>([...HOST_STATES, ...d.states]);

  const names = new Set<string>();
  const declaredEmits = new Set([...HOST_EVENT_TYPES, ...d.emits]);
  for (const a of d.actions) {
    if (names.has(a.name)) add(`action ${a.name} is declared twice`);
    names.add(a.name);
    if (a.callers.length === 0) add(`action ${a.name} has no callers`);
    if (a.from.length === 0) add(`action ${a.name} runs from no status`);
    for (const f of a.from) if (!reachable.has(f)) add(`action ${a.name} runs from ${f}, which is not one of its states`);
    for (const f of a.from) {
      for (const to of allowedTargets(a, f)) {
        if (!reachable.has(to)) add(`action ${a.name} leaves the process ${to}, which is not one of its states`);
      }
    }
    for (const e of a.emits) {
      if (!declaredEmits.has(e)) add(`action ${a.name} emits ${e}, which the type's emits does not list`);
    }
    if (a.callers.includes("resident") && !a.input_schema) {
      add(`resident action ${a.name} has no input_schema (with examples) for callers and the conformance suite`);
    }
    if (a.input_schema && !Array.isArray(a.input_schema.examples)) {
      add(`action ${a.name}'s input_schema has no examples`);
    }
  }

  // Events: each one the serializer can put on the wire.
  for (const e of d.emits) {
    if (HOST_EVENT_TYPES.includes(e)) add(`emits lists ${e}, which the hub emits for every type; leave it out`);
    if (!host.mappedEventTypes.includes(e)) add(`emits ${e}, which the activity serializer does not map`);
  }

  // Storage: under row-level security, and in the export.
  for (const table of d.tables) {
    if (!host.hubTables.includes(table)) add(`table ${table} is not in HUB_TABLES (forced row-level security)`);
    if (!host.exportManifest.includes(table)) add(`table ${table} is not in the export manifest`);
  }
  for (const req of handler.requiredSchema ?? []) {
    if (!d.tables.includes(req.table)) add(`requiredSchema names ${req.table}, which tables does not list`);
  }

  // Creation.
  const kind = host.draftKinds.find((k) => k.processType === t);
  if (d.creation.resident) {
    if (!kind) add(`says residents draft it at ${d.creation.resident.drafts}, but no draft kind makes it`);
    else if (!d.tables.includes(kind.table)) add(`its drafts table ${kind.table} is not in tables`);
    if (!handler.reopenDraft || !handler.draftPath) add(`residents draft it, but the handler has no draftPath/reopenDraft`);
  } else if (kind) {
    add(`a draft kind makes it, but creation.resident is null`);
  }
  if (d.creation.resident && !d.examples.draft) add(`residents draft it, but examples.draft is missing`);
  if (d.creation.admin && !d.examples.create) add(`admins create it, but examples.create is missing`);
  if (!d.creation.resident && !d.creation.admin && !d.creation.system && d.type !== "civic.vote_results") {
    // vote_results is the one retired type: no new ones are made.
    add(`nothing creates it: creation is resident null, admin false, system false`);
  }

  // Deadline, brief, approval: the descriptor and the handler say the same.
  if (d.deadline) {
    const close = d.actions.find((a) => a.name === d.deadline!.action);
    if (!close) add(`its deadline runs ${d.deadline.action}, which is not one of its actions`);
    else if (!close.callers.includes("system")) add(`its deadline action ${close.name} is not callable by the hub (system)`);
    if (!handler.closeIfExpired) add(`declares a deadline but the handler has no closeIfExpired`);
  } else if (handler.closeIfExpired) {
    add(`the handler closes at a deadline (closeIfExpired) but the descriptor declares none`);
  }
  if (d.brief !== Boolean(handler.generateBrief)) {
    add(d.brief ? `declares a brief but the handler has no generateBrief` : `the handler makes a brief but brief is false`);
  }
  if (handler.activationOnApproval) {
    if (!d.creation.resident && !d.creation.admin) add(`activates on approval but nothing submits it for review`);
    for (const activation of approvalSamples(handler)) {
      if (!reachable.has(activation.status as ProcessStatus)) {
        add(`approval lands it at ${activation.status}, which is not one of its states`);
      }
      if (activation.action) {
        const a = d.actions.find((x) => x.name === activation.action!.type);
        if (!a) add(`approval runs ${activation.action.type}, which is not one of its actions`);
        else {
          if (!a.callers.includes("system")) add(`approval runs ${a.name}, which the hub (system) may not call`);
          const from = activation.action.onFailure === "required" ? "pending_review" : activation.status;
          if (!a.from.includes(from as ProcessStatus)) {
            add(`approval runs ${a.name} from ${from}, which the action's from does not include`);
          }
        }
      }
    }
  }
  return problems;
}

/**
 * What approval does, for the configurations a handler distinguishes. Every
 * type today answers the same for any process except the vote (direct or
 * proposal-required activation), so both of those are sampled.
 */
function approvalSamples(handler: ProcessHandler) {
  const base = {
    id: "proc_sample",
    definition: { type: handler.type, version: "0.1" },
    title: "",
    description: "",
    status: "pending_review" as ProcessStatus,
    hubId: "",
    jurisdiction: "",
    createdBy: "",
    createdAt: "",
    updatedAt: "",
  };
  return [
    handler.activationOnApproval!({ ...base, state: { config: { activation_mode: "direct" } } }),
    handler.activationOnApproval!({ ...base, state: { config: { activation_mode: "proposal_required" } } }),
  ];
}
