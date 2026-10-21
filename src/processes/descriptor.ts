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

export type { TypeDisplay, TypeSection } from "../shared/typeDisplay.js";
import type {
  ActionDescriptor,
  DescriptorRole,
  ProcessTypeDescriptor,
  TrustTier,
} from "./descriptorTypes.js";
export type {
  ActionDescriptor,
  DescriptorRole,
  JsonSchema,
  OutsideService,
  ProcessTypeDescriptor,
  TrustTier,
} from "./descriptorTypes.js";

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
