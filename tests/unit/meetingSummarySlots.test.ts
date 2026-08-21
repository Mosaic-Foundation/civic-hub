// Per-meeting slot dedupe — the last-resort layer.
//
// Document fingerprints are the precise cross-connector match, but they only
// hold while the documents persist. Floyd produced a duplicate summary for the
// 2026-06-23 Regular Meeting: an existing record from June and a fresh one from
// the wix-cms connector, same meeting, same topics. If a jurisdiction replaces
// an agenda PDF with a revised one, or drops a recording, the old summary and
// the new entry share nothing to match on.
//
// Counting summaries per meeting closes that gap — WITHOUT reintroducing the
// same-day collision bug, because a date+type that genuinely hosts two meetings
// gets two slots and only the surplus is created.

import { describe, it, expect } from "vitest";

/** Mirrors meetingKey() in meetingSummaryController.ts. */
function meetingKey(date: string, title: string): string {
  const normalized = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${date}::${normalized}`;
}

/**
 * The slot decision, extracted so the rule is testable without a database.
 * Returns the entries that would be created.
 */
function planCreations(
  existing: Array<{ meeting_date: string; meeting_title: string }>,
  discovered: Array<{ meeting_date: string; meeting_title: string }>,
): Array<{ meeting_date: string; meeting_title: string }> {
  const slots = new Map<string, number>();
  for (const e of existing) {
    const k = meetingKey(e.meeting_date, e.meeting_title);
    slots.set(k, (slots.get(k) ?? 0) + 1);
  }
  const created: typeof discovered = [];
  for (const d of discovered) {
    const k = meetingKey(d.meeting_date, d.meeting_title);
    const remaining = slots.get(k) ?? 0;
    if (remaining > 0) {
      slots.set(k, remaining - 1);
      continue;
    }
    created.push(d);
  }
  return created;
}

const regular = (d: string) => ({ meeting_date: d, meeting_title: "Regular Meeting" });
const workshop = (d: string) => ({ meeting_date: d, meeting_title: "Budget Workshop Meeting" });

describe("per-meeting slot dedupe", () => {
  it("does not re-create a meeting that already has a summary", () => {
    // The Floyd 2026-06-23 duplicate, with no shared documents.
    expect(planCreations([regular("2026-06-23")], [regular("2026-06-23")])).toEqual([]);
  });

  it("still creates a meeting that has no summary yet", () => {
    expect(planCreations([], [regular("2026-08-11")])).toHaveLength(1);
  });

  it("keeps two DIFFERENT meetings on the same date separate", () => {
    // Budget Workshop + Regular Meeting on 2026-06-23 are two meetings.
    const out = planCreations([regular("2026-06-23")], [
      regular("2026-06-23"),
      workshop("2026-06-23"),
    ]);
    expect(out).toEqual([workshop("2026-06-23")]);
  });

  it("creates BOTH same-day same-type meetings when neither exists", () => {
    // Floyd's 2023-04-11: two separate Budget Workshop Meetings.
    const out = planCreations([], [workshop("2023-04-11"), workshop("2023-04-11")]);
    expect(out).toHaveLength(2);
  });

  it("creates only the surplus when one of two same-type meetings exists", () => {
    const out = planCreations([workshop("2023-04-11")], [
      workshop("2023-04-11"),
      workshop("2023-04-11"),
    ]);
    expect(out).toHaveLength(1);
  });

  it("is unaffected by meeting-title punctuation and casing drift", () => {
    const out = planCreations(
      [{ meeting_date: "2026-06-23", meeting_title: "regular  meeting" }],
      [{ meeting_date: "2026-06-23", meeting_title: "Regular Meeting" }],
    );
    expect(out).toEqual([]);
  });

  it("does not let one existing summary suppress a whole date", () => {
    const out = planCreations([regular("2026-06-23")], [
      regular("2026-06-23"),
      workshop("2026-06-23"),
      { meeting_date: "2026-06-23", meeting_title: "Public Hearing" },
    ]);
    expect(out).toHaveLength(2);
  });

  it("converges — a second run after the first creates nothing new", () => {
    const discovered = [regular("2026-06-23"), workshop("2026-06-23")];
    const firstRun = planCreations([], discovered);
    expect(firstRun).toHaveLength(2);
    const secondRun = planCreations(firstRun, discovered);
    expect(secondRun).toEqual([]);
  });
});
