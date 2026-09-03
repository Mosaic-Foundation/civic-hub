import { describe, it, expect } from "vitest";
import { stripMarkdown } from "../../src/shared/markdown.js";

describe("stripMarkdown — plain-text surfaces never see markers", () => {
  it("leaves plain text alone", () => {
    const plain = "What we need right now:\n- Neighbors willing to pitch in\nStatus: Early";
    expect(stripMarkdown(plain)).toBe("What we need right now:\nNeighbors willing to pitch in\nStatus: Early");
  });
  it("unwraps bold, italic, links, code, strikethrough", () => {
    expect(stripMarkdown("**What we need** right *now* — see [the plan](https://x.y) and `code` ~~gone~~")).toBe(
      "What we need right now — see the plan and code gone",
    );
  });
  it("drops headings, quotes, list markers, rules", () => {
    expect(stripMarkdown("## Status\n> early\n1. one\n2) two\n* three\n---\nend")).toBe(
      "Status\nearly\none\ntwo\nthree\n\nend",
    );
  });
  it("keeps a lone asterisk or underscore that is not a marker", () => {
    expect(stripMarkdown("5 * 3 = 15 and snake_case stays")).toBe("5 * 3 = 15 and snake_case stays");
  });
});
