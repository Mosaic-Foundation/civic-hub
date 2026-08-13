// civic.brief module — lifecycle transitions
//
// Mirrors civic.vote_results: a brief sits `pending` awaiting admin
// review, then approval walks it approved → published as delivery and
// publication complete.

import type { BriefProcessState, BriefPublicationStatus } from "./models.js";

export function canEdit(state: BriefProcessState): boolean {
  return state.publication_status === "pending";
}

export function canApprove(state: BriefProcessState): boolean {
  return state.publication_status === "pending";
}

export function isPublished(state: BriefProcessState): boolean {
  return state.publication_status === "published";
}

/**
 * Validate an intended publication_status transition. Throws on invalid
 * transitions so callers don't have to re-encode the rules.
 */
export function assertPublicationTransition(
  from: BriefPublicationStatus,
  to: BriefPublicationStatus,
): void {
  const allowed: Record<BriefPublicationStatus, BriefPublicationStatus[]> = {
    pending: ["approved"],
    approved: ["published"],
    published: [],
  };
  if (!allowed[from].includes(to)) {
    throw new Error(`Invalid brief publication transition: ${from} → ${to}`);
  }
}
