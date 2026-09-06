// The admin "endorsements needed" setting reaches a vote through one helper,
// snapshotted at submission. These pin the two things that matter: a positive
// number is a proposed vote that gathers support, and 0 is a vote that opens
// on approval — expressed through the same registry seam every approval uses.

import { describe, it, expect } from "vitest";
import { supportPhaseConfig, createVoteState } from "../../src/modules/civic.vote/index.js";
import { activationOnApproval } from "../../src/processes/registry.js";
import type { Process } from "../../src/models/process.js";

function voteProcess(state: Record<string, unknown>): Process {
  return {
    id: "proc_test",
    definition: { type: "civic.vote", version: "0.1" },
    title: "Test",
    description: "",
    status: "pending_review",
    hubId: "civic-hub-test",
    jurisdiction: "local",
    createdBy: "user_test",
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
    state,
  };
}

describe("supportPhaseConfig", () => {
  it("a positive threshold is a proposed vote that gathers support", () => {
    expect(supportPhaseConfig(5)).toEqual({ support_threshold: 5, activation_mode: "proposal_required" });
    expect(supportPhaseConfig(1)).toEqual({ support_threshold: 1, activation_mode: "proposal_required" });
  });

  it("0 skips the support phase", () => {
    expect(supportPhaseConfig(0)).toEqual({ support_threshold: 0, activation_mode: "direct" });
  });

  it("never produces a negative or fractional threshold", () => {
    expect(supportPhaseConfig(-3)).toEqual({ support_threshold: 0, activation_mode: "direct" });
    expect(supportPhaseConfig(2.6).support_threshold).toBe(3);
  });

  it("carries through createVoteState — 0 is kept, not defaulted to 5", () => {
    const state = createVoteState({ method: "yes_no_unsure", ...supportPhaseConfig(0) });
    expect(state.config.support_threshold).toBe(0);
    expect(state.config.activation_mode).toBe("direct");
  });

  it("approval opens a 0-threshold vote directly, and proposes any other", () => {
    const direct = createVoteState({ method: "yes_no_unsure", ...supportPhaseConfig(0) });
    expect(activationOnApproval(voteProcess(direct as unknown as Record<string, unknown>)).status).toBe("active");

    const proposed = createVoteState({ method: "yes_no_unsure", ...supportPhaseConfig(2) });
    expect(activationOnApproval(voteProcess(proposed as unknown as Record<string, unknown>)).status).toBe("proposed");
  });
});
