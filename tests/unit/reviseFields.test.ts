// Audit 2 (left over from Audit 1): POST /reviews/:id/revise takes only a
// checked title, description and note, never a creator's raw content/config.

import { describe, expect, it } from "vitest";
import { reviseFields } from "../../src/controllers/reviewController.js";

describe("reviseFields", () => {
  it("takes what the My submissions page sends", () => {
    expect(reviseFields({ title: "  New title ", description: "Better", note: "Fixed it" })).toEqual({
      title: "New title",
      description: "Better",
      note: "Fixed it",
    });
  });

  it("refuses raw content, config or state", () => {
    for (const extra of [{ content: { body: "x" } }, { config: { options: [] } }, { state: { tally: {} } }]) {
      expect(typeof reviseFields({ title: "T", ...extra })).toBe("string");
    }
  });

  it("refuses an empty or overlong title and an overlong description", () => {
    expect(reviseFields({ title: "   " })).toMatch(/title is required/);
    expect(reviseFields({ title: "x".repeat(201) })).toMatch(/200 characters/);
    expect(reviseFields({ description: "x".repeat(20_001) })).toMatch(/20,000/);
    expect(reviseFields({ title: 42 })).toMatch(/title/);
  });
});
