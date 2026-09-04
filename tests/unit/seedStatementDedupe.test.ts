import { describe, it, expect } from "vitest";

/**
 * The parse applied to a conversation draft's seed statements at submit
 * (deliberationDraftController). Kept in step with that code; the behaviour it
 * pins is what stops `polis_err_post_comment_duplicate` from ever being
 * raised — the error that left an approved conversation stuck at "waiting to
 * start" with an orphaned Polis conversation on 2026-09-04.
 */
function parseSeeds(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => {
      const key = s.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

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
