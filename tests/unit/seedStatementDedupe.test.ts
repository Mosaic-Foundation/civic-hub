import { describe, it, expect } from "vitest";
import { parseSeedStatements as parseSeeds } from "../../src/shared/seedStatements.js";

/**
 * The parse applied to a conversation draft's seed statements at submit
 * (src/shared/seedStatements.ts, called by the conversation draft kind). The
 * behaviour it pins is what stops `polis_err_post_comment_duplicate` from
 * ever being raised — the error that left an approved conversation stuck at
 * "waiting to start" with an orphaned Polis conversation on 2026-09-04.
 */

describe("seed statements are deduplicated before they reach Polis", () => {
  it("drops an exact repeat", () => {
    expect(parseSeeds("A\nB\nA")).toEqual(["A", "B"]);
  });

  it("drops one that differs only by case or spacing", () => {
    // Polis matches on the text; a creator pasting a list rarely notices these.
    expect(parseSeeds("Dogs should be leashed\ndogs  should be   leashed")).toEqual([
      "Dogs should be leashed",
    ]);
  });

  it("keeps the first occurrence, preserving the creator's order", () => {
    expect(parseSeeds("second\nfirst\nSECOND")).toEqual(["second", "first"]);
  });

  it("still drops blanks and trims", () => {
    expect(parseSeeds("  A  \n\n\n  B\n   ")).toEqual(["A", "B"]);
  });

  it("leaves genuinely different statements alone", () => {
    const raw = [
      "My livestock has been harassed by a neighbour's dog.",
      "I let my dog roam and worry about it being shot.",
      "Animal control needs to be stronger.",
    ].join("\n");
    expect(parseSeeds(raw)).toHaveLength(3);
  });
});
