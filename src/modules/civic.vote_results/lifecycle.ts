// civic.vote_results module — lifecycle transitions
//
// A vote-results record's lifecycle is narrower than a vote's because it
// doesn't have a participation window. Once created, a vote-results
// record sits in `active` status with publication_status="pending"
// while it awaits admin review. Approval walks it through closed →
// finalized as publication completes.
//
// Process-level status transitions (draft | active | closed | finalized):
//
//   (implicit draft) → active      at creation
//   active → closed                on admin approval (review done)
//   closed → finalized             after email + result_published emit
//
// Publication sub-state (pending | approved | published) mirrors the
// admin workflow more finely than process status alone can.

import { ConflictError } from "../../errors/index.js";
import type { VoteResultsProcessState, VoteResultsPublicationStatus } from "./models.js";

export function canEdit(state: VoteResultsProcessState): boolean {
  return state.publication_status === "pending";
}

export function canApprove(state: VoteResultsProcessState): boolean {
  return state.publication_status === "pending";
}

export function isPublished(state: VoteResultsProcessState): boolean {
  return state.publication_status === "published";
}

/**
 * Validate an intended publication_status transition. Throws on invalid
 * transitions so callers don't have to re-encode the rules.
 */
export function assertPublicationTransition(
  from: VoteResultsPublicationStatus,
  to: VoteResultsPublicationStatus,
): void {
  const allowed: Record<VoteResultsPublicationStatus, VoteResultsPublicationStatus[]> = {
    pending: ["approved"],
    approved: ["published"],
    published: [],
  };
  if (!allowed[from].includes(to)) {
    throw new ConflictError(
      "That publication step is not allowed from the current state.",
      "invalid_transition",
    );
  }
}
