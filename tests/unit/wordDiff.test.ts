import { describe, it, expect } from "vitest";
import { wordDiff } from "../../ui/src/components/wordDiff.js";

const join = (runs: ReturnType<typeof wordDiff>, kind: string) =>
  runs.filter((r) => r.kind === kind).map((r) => r.text).join("");

describe("wordDiff — the edit history's word-level diff", () => {
  it("marks only the words that changed", () => {
    const runs = wordDiff("We need a site and volunteers.", "We need a confirmed site and many volunteers.");
    expect(join(runs, "removed")).toBe("");
    expect(join(runs, "added").trim().split(/\s+/)).toEqual(["confirmed", "many"]);
    expect(runs.filter((r) => r.kind === "same").map((r) => r.text).join("")).toContain("We need a ");
  });
  it("shows a replaced word as removed then added", () => {
    const runs = wordDiff("Status: Early", "Status: Underway");
    expect(join(runs, "removed")).toBe("Early");
    expect(join(runs, "added")).toBe("Underway");
  });
  it("keeps paragraph breaks and reports identical text as all-same", () => {
    const runs = wordDiff("one\n\ntwo", "one\n\ntwo");
    expect(runs.every((r) => r.kind === "same")).toBe(true);
    expect(runs.map((r) => r.text).join("")).toBe("one\n\ntwo");
  });
});
