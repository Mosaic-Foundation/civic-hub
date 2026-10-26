import { describe, it, expect } from "vitest";
import type {
  VoteResultsProcessState,
  VoteResultsPublicationStatus,
} from "../../packages/civic.vote_results/models.js";
import {
  canEdit,
  canApprove,
  isPublished,
  assertPublicationTransition,
} from "../../packages/civic.vote_results/lifecycle.js";

// The lifecycle predicates only read publication_status.
function st(status: VoteResultsPublicationStatus): VoteResultsProcessState {
  return { publication_status: status } as VoteResultsProcessState;
}

const ALL: VoteResultsPublicationStatus[] = ["pending", "approved", "published"];

describe("vote_results lifecycle — publication state machine", () => {
  it("canEdit / canApprove only while pending", () => {
    for (const s of ALL) {
      expect(canEdit(st(s))).toBe(s === "pending");
      expect(canApprove(st(s))).toBe(s === "pending");
    }
  });

  it("isPublished only when published", () => {
    for (const s of ALL) {
      expect(isPublished(st(s))).toBe(s === "published");
    }
  });

  describe("assertPublicationTransition", () => {
    it("allows the forward chain pending → approved → published", () => {
      expect(() => assertPublicationTransition("pending", "approved")).not.toThrow();
      expect(() => assertPublicationTransition("approved", "published")).not.toThrow();
    });

    it("rejects skips, reversals, and terminal exits", () => {
      expect(() => assertPublicationTransition("pending", "published")).toThrow(); // skip
      expect(() => assertPublicationTransition("approved", "pending")).toThrow(); // reverse
      expect(() => assertPublicationTransition("published", "approved")).toThrow(); // reverse
      expect(() => assertPublicationTransition("published", "published")).toThrow(); // terminal
      expect(() => assertPublicationTransition("pending", "pending")).toThrow(); // self
    });
  });
});
