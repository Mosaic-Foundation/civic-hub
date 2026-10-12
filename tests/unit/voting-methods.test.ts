import { describe, it, expect } from "vitest";
import {
  getVotingMethod,
  getAvailableMethods,
  DEFAULT_METHOD,
} from "../../src/modules/civic.vote/methods.js";

describe("Voting methods registry", () => {
  it("default method is yes_no_unsure", () => {
    expect(DEFAULT_METHOD).toBe("yes_no_unsure");
  });

  it("lists both available methods", () => {
    const methods = getAvailableMethods();
    expect(methods).toContain("yes_no_unsure");
    expect(methods).toContain("approval");
  });

  it("throws for unknown method", () => {
    expect(() => getVotingMethod("ranked_choice")).toThrow("Unknown voting method");
  });
});

describe("yes_no_unsure method", () => {
  const m = getVotingMethod("yes_no_unsure");
  const options = ["yes", "no", "unsure"];

  it("has correct default options", () => {
    expect(m.defaultOptions).toEqual(["yes", "no", "unsure"]);
  });

  describe("validateBallot", () => {
    it("accepts a valid option string", () => {
      expect(m.validateBallot("yes", options)).toBe("yes");
    });

    it("rejects non-string input", () => {
      expect(() => m.validateBallot(123, options)).toThrow("Choose an option to vote.");
    });

    it("rejects empty string", () => {
      expect(() => m.validateBallot("", options)).toThrow("Choose an option to vote.");
    });

    it("rejects unknown option", () => {
      expect(() => m.validateBallot("maybe", options)).toThrow("Invalid option");
    });
  });

  describe("isSameBallot", () => {
    it("matches identical strings", () => {
      expect(m.isSameBallot("yes", "yes")).toBe(true);
    });

    it("rejects different strings", () => {
      expect(m.isSameBallot("yes", "no")).toBe(false);
    });
  });

  describe("serializeForReceipt / deserializeReceipt", () => {
    it("round-trips a simple string", () => {
      const serialized = m.serializeForReceipt("no");
      expect(serialized).toBe("no");
      expect(m.deserializeReceipt(serialized)).toBe("no");
    });
  });

  describe("computeTally", () => {
    it("counts votes correctly", () => {
      // computeTally takes anonymized ballot values (no voter keys) — the
      // ballot-secrecy refactor: tallies come from vote_records, not a
      // per-user map.
      const ballots = ["yes", "no", "yes", "unsure"];
      const result = m.computeTally(ballots, options);
      expect(result.tally).toEqual({ yes: 2, no: 1, unsure: 1 });
      expect(result.total_votes).toBe(4);
    });

    it("handles empty votes", () => {
      const result = m.computeTally([], options);
      expect(result.tally).toEqual({ yes: 0, no: 0, unsure: 0 });
      expect(result.total_votes).toBe(0);
    });
  });

  describe("summarizeTally", () => {
    it("reports the leading option", () => {
      const result = m.computeTally(["yes", "yes", "no"], options);
      expect(m.summarizeTally(result)).toContain("yes");
      expect(m.summarizeTally(result)).toContain("67%");
    });

    it("handles no votes", () => {
      const result = m.computeTally([], options);
      expect(m.summarizeTally(result)).toBe("No votes recorded.");
    });
  });
});

describe("approval method", () => {
  const m = getVotingMethod("approval");
  const options = ["sidewalks", "bike lanes", "bus stops", "street lights"];

  it("has no default options (creator must supply)", () => {
    expect(m.defaultOptions).toBeNull();
  });

  it("requires at least 2 options", () => {
    expect(m.minOptions).toBe(2);
  });

  describe("validateBallot", () => {
    it("accepts a valid selection array", () => {
      expect(m.validateBallot(["sidewalks", "bike lanes"], options)).toEqual([
        "sidewalks",
        "bike lanes",
      ]);
    });

    it("rejects non-array input", () => {
      expect(() => m.validateBallot("sidewalks", options)).toThrow("payload.selections");
    });

    it("rejects empty array", () => {
      expect(() => m.validateBallot([], options)).toThrow("payload.selections");
    });

    it("rejects unknown options in array", () => {
      expect(() => m.validateBallot(["sidewalks", "monorail"], options)).toThrow(
        'Invalid selection "monorail"',
      );
    });

    it("deduplicates selections", () => {
      expect(m.validateBallot(["sidewalks", "sidewalks"], options)).toEqual([
        "sidewalks",
      ]);
    });

    it("accepts single selection", () => {
      expect(m.validateBallot(["bike lanes"], options)).toEqual(["bike lanes"]);
    });
  });

  describe("isSameBallot", () => {
    it("matches identical arrays", () => {
      expect(m.isSameBallot(["sidewalks", "bike lanes"], ["sidewalks", "bike lanes"])).toBe(true);
    });

    it("matches arrays with different order", () => {
      expect(m.isSameBallot(["bike lanes", "sidewalks"], ["sidewalks", "bike lanes"])).toBe(true);
    });

    it("rejects different sets", () => {
      expect(m.isSameBallot(["sidewalks"], ["sidewalks", "bike lanes"])).toBe(false);
    });
  });

  describe("serializeForReceipt / deserializeReceipt", () => {
    it("round-trips an array as JSON", () => {
      const ballot = ["sidewalks", "bus stops"];
      const serialized = m.serializeForReceipt(ballot);
      expect(serialized).toBe('["sidewalks","bus stops"]');
      expect(m.deserializeReceipt(serialized)).toBe("sidewalks, bus stops");
    });

    it("handles non-JSON gracefully", () => {
      expect(m.deserializeReceipt("just a string")).toBe("just a string");
    });
  });

  describe("computeTally", () => {
    it("counts approvals per option across voters", () => {
      const ballots = [
        ["sidewalks", "bike lanes"],
        ["sidewalks", "bus stops"],
        ["bike lanes", "bus stops", "street lights"],
      ];
      const result = m.computeTally(ballots, options);
      expect(result.tally).toEqual({
        sidewalks: 2,
        "bike lanes": 2,
        "bus stops": 2,
        "street lights": 1,
      });
      expect(result.total_votes).toBe(3);
    });

    it("total_votes is number of voters not sum of approvals", () => {
      const ballots = [
        ["sidewalks", "bike lanes", "bus stops", "street lights"],
      ];
      const result = m.computeTally(ballots, options);
      expect(result.total_votes).toBe(1);
      expect(result.tally.sidewalks).toBe(1);
    });

    it("handles empty votes", () => {
      const result = m.computeTally([], options);
      expect(result.total_votes).toBe(0);
      for (const count of Object.values(result.tally)) {
        expect(count).toBe(0);
      }
    });
  });

  describe("summarizeTally", () => {
    it("reports the most-approved option", () => {
      const ballots = [
        ["sidewalks"],
        ["sidewalks", "bike lanes"],
        ["bike lanes"],
      ];
      const result = m.computeTally(ballots, options);
      const summary = m.summarizeTally(result);
      expect(summary).toContain("Most approved:");
      expect(summary).toContain("sidewalks");
    });
  });
});
