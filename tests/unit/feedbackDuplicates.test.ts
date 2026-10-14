// Civic.Social's inbox groups likely duplicates: same stream, same page,
// similar words (src/shared/feedbackDuplicates.ts).

import { describe, expect, it } from "vitest";
import { groupLikelyDuplicates, similarity } from "../../src/shared/feedbackDuplicates.js";

const item = (id: string, page: string | null, message: string, stream = "bug") => ({
  id,
  created_at: "2026-10-13T09:00:00.000Z",
  stream,
  page_path: page,
  message,
});

describe("likely duplicates", () => {
  it("groups the same page with similar text", () => {
    const groups = groupLikelyDuplicates([
      item("a", "/vote/v1", "The results bars overlap the ballot on my phone"),
      item("b", "/vote/v1", "On my phone the results bars overlap the ballot"),
      item("c", "/vote/v1", "Please add a dark mode"),
    ]);
    expect(groups.map((g) => g.map((i) => i.id))).toEqual([["a", "b"], ["c"]]);
  });

  it("keeps similar text on different pages, or in different streams, apart", () => {
    const groups = groupLikelyDuplicates([
      item("a", "/vote/v1", "The results bars overlap the ballot"),
      item("b", "/vote/v2", "The results bars overlap the ballot"),
      item("c", "/vote/v1", "The results bars overlap the ballot", "feature"),
    ]);
    expect(groups).toHaveLength(3);
  });

  it("never groups an item with no page", () => {
    const groups = groupLikelyDuplicates([
      item("a", null, "Can we have a calendar export"),
      item("b", null, "Can we have a calendar export"),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("joins chains: a matches b, b matches c", () => {
    const groups = groupLikelyDuplicates([
      item("a", "/", "search box broken results empty"),
      item("b", "/", "search box broken results empty always"),
      item("c", "/", "search box broken results empty always today"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("scores word overlap, ignoring short and common words", () => {
    expect(similarity("The map is broken", "the MAP is broken!")).toBe(1);
    expect(similarity("", "anything")).toBe(0);
  });
});
