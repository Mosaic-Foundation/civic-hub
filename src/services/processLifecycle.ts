// processLifecycle.ts — the pure lifecycle DECISIONS of the process service.
//
// processService.ts is mostly DB orchestration + delegation to registry
// handlers; the parts that carry real risk are the small status/lifecycle
// rules it applies along the way. Phase 5 (audit §5) extracts those rules here
// — framework-free, DB-free, exhaustively testable — the same pattern the
// codebase already uses for transitions.ts / methods.ts / deadline.ts /
// feedActivity.ts. processService imports these so the rule and its test
// share one definition.

import type { ProcessStatus } from "../models/process.js";

/**
 * Statuses that are NOT publicly addressable / listed: a process still under
 * review, or soft-deleted/archived. The canonical `processes`-row status is
 * the single source of truth. Used BOTH by the `getAllProcesses` query filter
 * and by `getProcessState`'s direct-fetch gate, so they can't drift.
 */
export const NON_PUBLIC_STATUSES: readonly ProcessStatus[] = [
  "pending_review",
  "archived",
];

/**
 * Statuses in which residents are taking part right now: a vote gathering
 * support or open for ballots, a live proposal, conversation, project,
 * announcement. These are what a plugin switch hides mid-flight, and the
 * only statuses a scheduled (deadline) transition acts on. Read by the
 * Plugins page's warning (Phase 5 part one, step 0.4).
 */
export const LIVE_STATUSES: readonly ProcessStatus[] = [
  "proposed",
  "threshold_met",
  "active",
];

/**
 * The resting status a freshly-created process takes. A handler may declare one
 * in its initial state (e.g. civic.vote → "draft"); handlers that don't
 * (announcements, vote-results, deliberations) are created live → "active".
 */
export function resolveInitialStatus(
  stateStatus: ProcessStatus | undefined,
): ProcessStatus {
  return stateStatus ?? "active";
}

/**
 * Whether a process is fetchable by direct id / shown in the public list.
 * `false` for pending-review and archived processes (admin/owner-facing only).
 */
export function isPubliclyFetchable(status: ProcessStatus): boolean {
  return !NON_PUBLIC_STATUSES.includes(status);
}

/**
 * Whether a process can still accept actions. A finalized process is terminal
 * and rejects further actions.
 */
export function isActionable(status: ProcessStatus): boolean {
  return status !== "finalized";
}

/**
 * Whether an action that ran should emit a `civic.process.updated` lifecycle
 * event — only when it actually changed the process status (no-op status
 * writes don't deserve a feed/audit event).
 */
export function shouldEmitStatusUpdate(
  previous: ProcessStatus,
  next: ProcessStatus,
): boolean {
  return previous !== next;
}

/**
 * The PostgREST `in`-list literal for the non-public statuses, e.g.
 * `("pending_review","archived")`. Derived from NON_PUBLIC_STATUSES so the
 * `getAllProcesses` query and the fetch gate stay in lockstep.
 */
export function nonPublicStatusFilter(): string {
  return `(${NON_PUBLIC_STATUSES.map((s) => `"${s}"`).join(",")})`;
}
