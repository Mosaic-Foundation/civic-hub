// civic.vote lifecycle — strict state machine
//
// States: draft → proposed → threshold_met → active → closed → finalized
//
// Two valid paths, gated by activation_mode config:
//   proposal_required: draft → proposed → threshold_met → active → closed → finalized
//   direct:           draft → active → closed → finalized
//
// No skipping within a path. No reversal.

import { ConflictError } from "../../src/sdk/index.js";
import type { VoteStatus } from "./models.js";

type ActivationMode = "direct" | "proposal_required";

const TRANSITIONS_DIRECT: Record<VoteStatus, VoteStatus[]> = {
  draft: ["active"],
  proposed: ["threshold_met"],
  threshold_met: ["active"],
  active: ["closed"],
  closed: ["finalized"],
  finalized: [],
};

const TRANSITIONS_PROPOSAL_REQUIRED: Record<VoteStatus, VoteStatus[]> = {
  draft: ["proposed"],
  proposed: ["threshold_met"],
  threshold_met: ["active"],
  active: ["closed"],
  closed: ["finalized"],
  finalized: [],
};

function getTransitions(mode: ActivationMode): Record<VoteStatus, VoteStatus[]> {
  return mode === "direct" ? TRANSITIONS_DIRECT : TRANSITIONS_PROPOSAL_REQUIRED;
}

export function canTransition(from: VoteStatus, to: VoteStatus, mode: ActivationMode = "direct"): boolean {
  return getTransitions(mode)[from]?.includes(to) ?? false;
}

export function assertTransition(from: VoteStatus, to: VoteStatus, mode: ActivationMode = "direct"): void {
  if (!canTransition(from, to, mode)) {
    const valid = getTransitions(mode)[from];
    throw new ConflictError(
      `Invalid lifecycle transition: ${from} → ${to} (activation_mode: ${mode}). ` +
        `Valid transitions from "${from}": [${valid.join(", ")}]`
    );
  }
}

/** Returns true if the status allows accepting votes */
export function isVotingOpen(status: VoteStatus): boolean {
  return status === "active";
}

/** Returns true if the status allows accepting support endorsements */
export function isAcceptingSupport(status: VoteStatus): boolean {
  return status === "proposed";
}

/** Returns true if the process is in a terminal state */
export function isTerminal(status: VoteStatus): boolean {
  return status === "finalized";
}
