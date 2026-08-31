/**
 * Per-process resident numbering — the pure core behind "Resident N".
 *
 * assignResidentNumbers is the deterministic mapping both detail
 * endpoints (process state and the comment thread) rebuild per request;
 * these tests are what guarantees the two endpoints agree, and that the
 * numbering honors the fingerprint guardrail (per-process only — the
 * same contributor set in a different arrangement yields different
 * numbers, and nothing here consults anything global).
 */

import { describe, it, expect } from "vitest";
import {
  assignResidentNumbers,
  type Contribution,
} from "../../src/services/processAnonymity.js";

const NO_OFFICIALS = () => false;

function c(id: string, at: string): Contribution {
  return { id, at };
}

describe("assignResidentNumbers — order of first appearance", () => {
  it("numbers contributors 1..N by earliest timestamp (author first)", () => {
    const numbers = assignResidentNumbers(
      [
        c("author", "2026-08-01T00:00:00Z"), // the process author
        c("bob", "2026-08-02T10:00:00Z"),
        c("carol", "2026-08-03T10:00:00Z"),
      ],
      NO_OFFICIALS,
    );
    expect(numbers.get("author")).toBe(1);
    expect(numbers.get("bob")).toBe(2);
    expect(numbers.get("carol")).toBe(3);
  });

  it("dedupes repeat contributions to the EARLIEST appearance", () => {
    const numbers = assignResidentNumbers(
      [
        c("author", "2026-08-01T00:00:00Z"),
        c("bob", "2026-08-02T10:00:00Z"),
        c("author", "2026-08-04T10:00:00Z"), // author comments again later
        c("bob", "2026-08-05T10:00:00Z"),
      ],
      NO_OFFICIALS,
    );
    expect(numbers.get("author")).toBe(1);
    expect(numbers.get("bob")).toBe(2);
    expect(numbers.size).toBe(2);
  });

  it("is deterministic on timestamp ties (falls back to id order)", () => {
    const tied = [c("zed", "2026-08-01T00:00:00Z"), c("amy", "2026-08-01T00:00:00Z")];
    const a = assignResidentNumbers(tied, NO_OFFICIALS);
    const b = assignResidentNumbers([...tied].reverse(), NO_OFFICIALS);
    expect(a.get("amy")).toBe(1);
    expect(a.get("zed")).toBe(2);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it("ignores empty ids", () => {
    const numbers = assignResidentNumbers(
      [c("", "2026-08-01T00:00:00Z"), c("bob", "2026-08-02T00:00:00Z")],
      NO_OFFICIALS,
    );
    expect(numbers.size).toBe(1);
    expect(numbers.get("bob")).toBe(1);
  });
});

describe("assignResidentNumbers — officials and admins are exempt", () => {
  it("exempt contributors get no number and do not consume one", () => {
    // Officials show name + office publicly; admins show the "Admin"
    // label — neither is ever "Resident N", so neither takes a slot.
    const numbers = assignResidentNumbers(
      [
        c("supervisor", "2026-08-01T00:00:00Z"), // official author
        c("admin", "2026-08-01T12:00:00Z"), // hub admin comments early
        c("bob", "2026-08-02T00:00:00Z"),
        c("carol", "2026-08-03T00:00:00Z"),
      ],
      (id) => id === "supervisor" || id === "admin",
    );
    expect(numbers.has("supervisor")).toBe(false);
    expect(numbers.has("admin")).toBe(false);
    // bob is Resident 1 — the exempt contributors did not shift the sequence.
    expect(numbers.get("bob")).toBe(1);
    expect(numbers.get("carol")).toBe(2);
  });
});

describe("assignResidentNumbers — the fingerprint guardrail", () => {
  it("the same person gets DIFFERENT numbers in different processes", () => {
    // Process A: dana commented third.
    const processA = assignResidentNumbers(
      [
        c("amy", "2026-08-01T00:00:00Z"),
        c("bob", "2026-08-02T00:00:00Z"),
        c("dana", "2026-08-03T00:00:00Z"),
      ],
      NO_OFFICIALS,
    );
    // Process B: dana started it.
    const processB = assignResidentNumbers(
      [c("dana", "2026-08-05T00:00:00Z"), c("amy", "2026-08-06T00:00:00Z")],
      NO_OFFICIALS,
    );
    expect(processA.get("dana")).toBe(3);
    expect(processB.get("dana")).toBe(1);
    // Nothing about the number is derivable from the id alone.
    expect(processA.get("dana")).not.toBe(processB.get("dana"));
  });
});
