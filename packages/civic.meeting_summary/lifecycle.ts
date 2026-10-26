// civic.meeting_summary module — lifecycle transitions
//
// Meeting summaries follow the same admin-review pattern as civic.brief:
// pending → approved → published. The process-level status starts
// "active" at creation (aggregation has already completed synchronously)
// and jumps to "finalized" on approval publication. This matches the
// brief's documented deviation from Civic Process Spec §6.2 — "closed"
// is skipped because there is no participation window.

import { ConflictError } from "../../src/sdk/index.js";
import type {
  MeetingSummaryApprovalStatus,
  MeetingSummaryProcessState,
} from "./models.js";

export function canEdit(state: MeetingSummaryProcessState): boolean {
  return state.approval_status === "pending";
}

export function canApprove(state: MeetingSummaryProcessState): boolean {
  return state.approval_status === "pending";
}

export function isPublished(state: MeetingSummaryProcessState): boolean {
  return state.approval_status === "published";
}

/**
 * Validate an intended approval_status transition. Throws on invalid
 * transitions so callers don't have to re-encode the rules.
 */
export function assertApprovalTransition(
  from: MeetingSummaryApprovalStatus,
  to: MeetingSummaryApprovalStatus,
): void {
  const allowed: Record<
    MeetingSummaryApprovalStatus,
    MeetingSummaryApprovalStatus[]
  > = {
    pending: ["approved"],
    approved: ["published"],
    published: [],
  };
  if (!allowed[from].includes(to)) {
    throw new ConflictError(
      "That approval step is not allowed from the summary's current state.",
      "invalid_transition",
    );
  }
}
