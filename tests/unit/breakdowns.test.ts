// Breakdowns (districts and demographics, 2026-11-16): the suppression rule.
// Every value under 5 is hidden, and no row or column is left with exactly
// one hidden value, so none can be worked out from a total that is shown.

import { describe, expect, it } from "vitest";
import { breakdownAsText, suppress, type Breakdown } from "../../src/services/breakdowns.js";

const hiddenIn = (line: Array<number | null>) => line.filter((v) => v === null).length;

function columns<T>(m: T[][]): T[][] {
  return m[0]!.map((_, c) => m.map((row) => row[c]!));
}

/** No line with exactly one hidden value. */
function safe(m: Array<Array<number | null>>): boolean {
  return [...m, ...columns(m)].every((line) => hiddenIn(line) !== 1);
}

describe("suppress", () => {
  it("shows everything when every value is 5 or more", () => {
    expect(suppress([[5, 9, 14], [6, 7, 13]])).toEqual([[5, 9, 14], [6, 7, 13]]);
  });

  it("hides values under 5, zero included", () => {
    const out = suppress([[0, 12, 12], [3, 20, 23], [9, 9, 18]]);
    expect(out[0]![0]).toBeNull();
    expect(out[1]![0]).toBeNull();
    expect(safe(out)).toBe(true);
  });

  it("hides a second value in a row so the hidden one can't be taken from the row's total", () => {
    // Row: Yes 3, No 40, total 43. Hiding 3 alone leaves 43 - 40.
    const out = suppress([[3, 40, 43], [20, 25, 45]]);
    expect(out[0]![0]).toBeNull();
    expect(hiddenIn(out[0]!)).toBeGreaterThan(1);
    expect(safe(out)).toBe(true);
  });

  it("hides a second value in a column so the hidden one can't be taken from the overall total", () => {
    // One group of 2 people: a one-column table (participants).
    const out = suppress([[2], [30], [12]]);
    expect(out[0]![0]).toBeNull();
    expect(out[2]![0]).toBeNull();
    expect(out[1]![0]).toBe(30);
  });

  it("leaves no line with exactly one hidden value, whatever the numbers", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let t = 0; t < 200; t++) {
      // Every real table has at least two rows: its groups and "Not provided".
      const rows = 2 + Math.floor(rand() * 6);
      const cols = 1 + Math.floor(rand() * 4);
      const m = Array.from({ length: rows }, () => {
        const cells = Array.from({ length: cols }, () => Math.floor(rand() * 12));
        return [...cells, cells.reduce((a, b) => a + b, 0)];
      });
      const out = suppress(m);
      expect(safe(out), JSON.stringify(m)).toBe(true);
      out.forEach((row, r) => row.forEach((v, c) => v !== null && expect(v).toBe(m[r]![c])));
      out.forEach((row, r) => row.forEach((v, c) => m[r]![c]! < 5 && expect(v).toBeNull()));
    }
  });
});

describe("a table as text, for a brief", () => {
  it("says each group's numbers, and hides what is hidden", () => {
    const b: Breakdown = {
      process_id: "p",
      dimension: "district",
      kind: "results",
      title: "Results by district",
      group_label: "District",
      columns: ["Yes", "No"],
      rows: [
        { key: "a", label: "Courthouse", cells: [12, 7], total: 19 },
        { key: "b", label: "Little River", cells: [null, null], total: null },
      ],
      hidden_label: "Fewer than 5",
    };
    expect(breakdownAsText(b)).toBe("Courthouse: Yes 12, No 7 (19 in all)\nLittle River: Fewer than 5");
  });
});
