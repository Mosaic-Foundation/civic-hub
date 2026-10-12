import { ConflictError } from "../../errors/index.js";
import type { ReviewStatus, ReviewTurnAction, ReviewActorRole } from "./models.js";

export interface Transition {
  from: ReviewStatus;
  action: ReviewTurnAction;
  actor_role: ReviewActorRole;
  to: ReviewStatus;
}

const VALID_TRANSITIONS: Transition[] = [
  { from: "pending_review", action: "approve", actor_role: "admin", to: "approved" },
  { from: "pending_review", action: "request_changes", actor_role: "admin", to: "changes_requested" },
  { from: "pending_review", action: "decline", actor_role: "admin", to: "declined" },
  { from: "pending_review", action: "withdraw", actor_role: "creator", to: "withdrawn" },
  { from: "changes_requested", action: "revise_resubmit", actor_role: "creator", to: "pending_review" },
  { from: "changes_requested", action: "withdraw", actor_role: "creator", to: "withdrawn" },
];

export function findTransition(
  from: ReviewStatus,
  action: ReviewTurnAction,
  actor_role: ReviewActorRole,
): Transition | undefined {
  return VALID_TRANSITIONS.find(
    (t) => t.from === from && t.action === action && t.actor_role === actor_role,
  );
}

export function isValidTransition(
  from: ReviewStatus,
  action: ReviewTurnAction,
  actor_role: ReviewActorRole,
): boolean {
  return findTransition(from, action, actor_role) !== undefined;
}

export function getNextStatus(
  from: ReviewStatus,
  action: ReviewTurnAction,
  actor_role: ReviewActorRole,
): ReviewStatus {
  const t = findTransition(from, action, actor_role);
  if (!t) {
    throw new ConflictError(`Invalid transition: ${from} + ${action} by ${actor_role}`);
  }
  return t.to;
}

export function getAllowedActions(
  from: ReviewStatus,
  actor_role: ReviewActorRole,
): ReviewTurnAction[] {
  return VALID_TRANSITIONS
    .filter((t) => t.from === from && t.actor_role === actor_role)
    .map((t) => t.action);
}
