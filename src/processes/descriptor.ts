// The process type descriptor: what one process type is, declared once.
//
// Every registered type declares one (ProcessHandler.descriptor). It states
// the type's lifecycle states and transitions, its actions and who may call
// each, the event types it emits, the tables it owns, how a process of it
// comes into being, and its trust tier with any outside service. Shaped after
// the Civic Process Specification §12.1 descriptor (actions as `name`,
// `input_schema`, `emits`) and the plugin architecture's manifest (§3, §4.1:
// tier, `activities.emit`, state tables). Only what serves the hub and the
// conformance suite; a contract version comes when there is a second version
// or a second host (Adam, 2026-10-12).
//
// It is load-bearing, not documentation:
//   - the registry derives each type's resident allowlist, its retry-safe
//     actions and its plugin from it (src/processes/registry.ts);
//   - executeAction refuses an action the descriptor does not open to the
//     caller, and checks each action's from/to against what happened
//     (src/services/processService.ts);
//   - the emission path checks every event against the type's declared
//     event types: plugin architecture §5a, Stage 1 (src/events/eventEmitter.ts);
//   - tests/unit/processDescriptors.test.ts checks each descriptor against its
//     handler, and the conformance suite (tests/conformance/) walks every
//     registered type through what its descriptor says applies.
//
// A disagreement between a descriptor and what its handler did is refused
// outside production (so tests catch it) and reported in production (so a
// descriptor gap never blocks a resident): descriptorViolation() below
// (Adam, 2026-10-12).
//
// This module imports nothing from the hub but the env reader and the error
// reporter, so the emission path can read declarations without a cycle.

import { isProductionEnv } from "../config/env.js";
import { reportError, type ErrorDetails } from "../utils/reportError.js";
import type { ProcessStatus } from "../models/process.js";
import type { TypeDisplay } from "../shared/typeDisplay.js";

export type { TypeDisplay, TypeSection } from "../shared/typeDisplay.js";

/**
 * Who may call an action through executeAction.
 *   resident: any signed-in resident;
 *   creator:  the resident who created the process (a project's Complete);
 *   admin:    a hub admin;
 *   system:   the hub acting on its own (a deadline close, an approval's
 *             activation, a seed).
 * An admin may call anything a resident or creator may.
 */
export type DescriptorRole = "resident" | "creator" | "admin" | "system";

/**
 * Plugin architecture §2. Tier 1: first-party code in the hub's process.
 * Tier 2: sandboxed third-party code; no sandbox runtime exists yet, so no
 * descriptor may declare it (the conformance suite keeps a slot). Tier 3: an
 * external service the hub reaches through one adapter (§10a).
 */
export type TrustTier = 1 | 2 | 3;

/**
 * Statuses any process can be in whatever its type, because the hub, not the
 * type, puts it there: under review before approval, and archived by an
 * admin (restore puts it back where it was). Not repeated in `states`.
 */
export const HOST_STATES: readonly ProcessStatus[] = ["pending_review", "archived"];

/**
 * Event types the hub emits about a process of any type, so no descriptor
 * repeats them: its creation, a status change or an archive
 * (civic.process.updated), a comment through the shared comment module,
 * and the review's own restricted events.
 */
export const HOST_EVENT_TYPES: readonly string[] = [
  "civic.process.created",
  "civic.process.updated",
  "civic.process.comment_added",
  "civic.review.submitted",
  "civic.review.approved",
  "civic.review.changes_requested",
  "civic.review.revised",
  "civic.review.declined",
  "civic.review.withdrawn",
];

/** A JSON Schema (draft 2020-12) object. `examples[0]` is what the conformance suite sends. */
export type JsonSchema = Record<string, unknown>;

export interface ActionDescriptor {
  /** What a caller passes as the action's type. */
  name: string;
  description: string;
  /** Who may call it. */
  callers: readonly DescriptorRole[];
  /** The `processes.status` values it may run from. */
  from: readonly ProcessStatus[];
  /**
   * The status it leaves the process in: one status, one of several (a poll
   * that may close), or null for "unchanged".
   */
  to: ProcessStatus | readonly ProcessStatus[] | null;
  /** The event types it emits about the process, beyond HOST_EVENT_TYPES. */
  emits: readonly string[];
  /**
   * Whether executeAction may run it again on a fresh read when another write
   * landed in between (Audit 3). Safe only when its every effect is its change
   * to the process row and the events written with it.
   */
  retry_safe?: boolean;
  /** The payload it accepts. `examples[0]` is a valid payload. */
  input_schema?: JsonSchema;
  /**
   * Each participant may do it once (Civic Process Specification §12.2): a
   * second call by the same person is refused with 409, however many arrive
   * at the same moment.
   */
  once_per_participant?: boolean;
}

/**
 * An outside service a Tier 3 type depends on (plugin architecture §10a),
 * declared so the conformance suite can check the hub's side of the contract
 * and report what does not meet it.
 */
export interface OutsideService {
  name: string;
  /** The one hub module that speaks the service's API (§10a.4). */
  adapter: string;
  /** The hub setting that holds the service's address (§4.1 network.egress). */
  egress_setting: string;
  /**
   * What the service is told about a participant (§10a.1).
   *   opaque_per_participant: a stable identifier made for the service alone;
   *   account_id: the hub's own account id (stable, but not opaque, and the
   *               same across every process).
   */
  participant_identifier: "opaque_per_participant" | "account_id";
  /**
   * How the hub authenticates to the service (§10a.1).
   *   per_participant: participant traffic carries a per-participant credential;
   *   shared_service_token: one long-lived token for every call, the
   *                         anti-pattern the spec names.
   */
  service_credential: "per_participant" | "shared_service_token";
  /** Whether the service itself refuses participants the hub did not allow (§10a.5). */
  service_allowlist: boolean;
  /** What participant data the service keeps (§10a.7). */
  data_retained: readonly string[];
  /** How that data leaves the service (§10a.7). */
  export_path: string;
  /**
   * The hub routes a resident takes part through, which reach the service
   * through the adapter (`:id` is the process id). The conformance suite
   * calls them to see what crosses the boundary per participant (§10a.1)
   * and that the hub decides who may take part (§10a.5).
   */
  participation: ReadonlyArray<{ method: "POST"; path: string; body: Record<string, unknown> }>;
}

export interface ProcessTypeDescriptor<P extends string = string> {
  type: string;
  version: string;
  tier: TrustTier;
  /** The plugin that switches this type on and off on a hub (a literal, so PluginId is derived). */
  plugin: P;
  /** The statuses its own lifecycle uses (HOST_STATES are implied). */
  states: readonly ProcessStatus[];
  /** The status createProcess gives a new one. */
  initial_status: ProcessStatus;
  actions: readonly ActionDescriptor[];
  /**
   * Every event type it emits, inside actions or not (its module's own
   * routes), beyond HOST_EVENT_TYPES: §4.1 `activities.emit`.
   */
  emits: readonly string[];
  /** How a process of this type comes into being. */
  creation: {
    /** A resident drafts one: the API path of its drafts. Null: residents cannot create it. */
    resident: { drafts: string } | null;
    /** An admin creates one directly. */
    admin: boolean;
    /** The hub creates one itself (a brief on close, a meeting summary job). */
    system: boolean;
  };
  /** A deadline the hub closes it at, and the action that does it. Null: no deadline. */
  deadline: { action: string; source: string } | null;
  /** Whether it produces a Civic Brief when it closes (generateBrief). */
  brief: boolean;
  /** The tables it owns beyond `processes`. */
  tables: readonly string[];
  /** Tier 3: the services it reaches. */
  outside_services: readonly OutsideService[];
  /**
   * What the conformance suite sends to make one (tests/conformance/). A
   * plugin author supplies these so the suite can drive the type with no
   * type-specific test code:
   *   draft:  the fields of a submittable draft, for a type residents draft
   *           (PATCHed onto a new draft at creation.resident.drafts);
   *   create: the request an admin makes to create one directly (POST to
   *           `path`, default /process).
   */
  examples: {
    draft?: Record<string, unknown>;
    create?: { path?: string; body: Record<string, unknown> };
  };
  /** How the hub's pages name and place it (navigation slice, 2026-10-14). */
  display: TypeDisplay;
}

/** The parts of a descriptor that are served publicly (GET /.well-known/civic.json). */
export interface PublicProcessType {
  type: string;
  version: string;
  tier: TrustTier;
  /** How residents name one and several (Architecture 2: a consumer needs a display name). */
  display: { label: string; plural: string };
  lifecycle: { states: readonly ProcessStatus[] };
  actions: Array<{
    name: string;
    description: string;
    callers: readonly DescriptorRole[];
    from: readonly ProcessStatus[];
    to: ProcessStatus | readonly ProcessStatus[] | null;
    emits: readonly string[];
    once_per_participant: boolean;
  }>;
  emits: readonly string[];
}

/** Only what a consumer may know: no table names, settings or adapters (Adam, 2026-10-12). */
export function publicDescriptor(d: ProcessTypeDescriptor): PublicProcessType {
  return {
    type: d.type,
    version: d.version,
    tier: d.tier,
    display: { label: d.display.label, plural: d.display.plural },
    lifecycle: { states: [...d.states, ...HOST_STATES] },
    actions: d.actions.map((a) => ({
      name: a.name,
      description: a.description,
      callers: a.callers,
      from: a.from,
      to: a.to,
      emits: a.emits,
      once_per_participant: a.once_per_participant === true,
    })),
    emits: [...new Set([...HOST_EVENT_TYPES, ...d.emits])].sort(),
  };
}

// --- Declarations the emission path reads ------------------------------------

const declared = new Map<string, ProcessTypeDescriptor>();

/** Called by the registry for each registered type. */
export function registerDescriptor(d: ProcessTypeDescriptor): void {
  declared.set(d.type, d);
}

export function descriptorFor(type: string): ProcessTypeDescriptor | undefined {
  return declared.get(type);
}

/** Whether a type declares (or the hub emits for every type) this event type. */
export function isDeclaredEventType(type: string, eventType: string): boolean {
  const d = declared.get(type);
  if (!d) return true; // not a registered type: nothing to check against
  return HOST_EVENT_TYPES.includes(eventType) || d.emits.includes(eventType);
}

/** The statuses an action may leave a process in. */
export function allowedTargets(action: ActionDescriptor, from: ProcessStatus): readonly ProcessStatus[] {
  if (action.to === null) return [from];
  return typeof action.to === "string" ? [action.to] : action.to;
}

// --- Disagreements -----------------------------------------------------------

/** A handler did something its descriptor does not declare. */
export class DescriptorViolationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DescriptorViolationError";
  }
}

/**
 * Refuse outside production, report in production. `code` names the rule
 * (descriptor.undeclared_event, descriptor.undeclared_action,
 * descriptor.wrong_from, descriptor.wrong_to); the message names the type and
 * what it did, with no values from the database.
 */
export function descriptorViolation(code: string, message: string, context: ErrorDetails): void {
  if (isProductionEnv()) {
    reportError(code, message, context);
    return;
  }
  throw new DescriptorViolationError(code, message);
}

/** The input of a type's deadline action; see src/shared/deadlineClose.ts. */
export { DEADLINE_CLOSE_INPUT } from "../shared/deadlineClose.js";
