// Summaries that predate their own meeting.
//
// Floyd County posts agendas about four days ahead and recordings about a day
// after. The cron reliably caught the agenda first and wrote a summary of
// PLANNED topics — then never revisited it, because the upgrade pass only
// fired when official MINUTES appeared. The 2026-08-25 meeting sat exactly
// that way: summarized 2026-08-22 from the agenda, recording posted 2026-08-26,
// nothing re-read it, and every counter reported a clean run.
//
// Two rules come out of that, and these pin both.

import { describe, it, expect } from "vitest";

/** Mirrors summaryPredatesMeeting() in meetingSummaryController.ts. */
function summaryPredatesMeeting(state: {
  generated_at?: string;
  meeting_date?: string;
}): boolean {
  const generated = (state.generated_at ?? "").slice(0, 10);
  const meeting = state.meeting_date ?? "";
  if (!generated || !meeting) return false;
  return generated < meeting;
}

/** Mirrors the creation-loop guard. */
function shouldDefer(meeting_date: string, today: string): boolean {
  return meeting_date > today;
}

/** Mirrors the upgrade trigger. */
function shouldUpgrade(
  entry: { source_minutes_url: string | null; source_video_url: string | null },
  existing: { generated_at: string; meeting_date: string },
): boolean {
  if (!entry.source_minutes_url && !entry.source_video_url) return false;
  if (entry.source_minutes_url) return true;
  return summaryPredatesMeeting(existing);
}

describe("summaryPredatesMeeting", () => {
  it("flags the Aug 2026 case — written three days before the meeting", () => {
    expect(
      summaryPredatesMeeting({
        generated_at: "2026-08-22T11:31:00Z",
        meeting_date: "2026-08-25",
      }),
    ).toBe(true);
  });

  it("does not flag a summary written after the meeting", () => {
    expect(
      summaryPredatesMeeting({
        generated_at: "2026-08-26T12:00:00Z",
        meeting_date: "2026-08-25",
      }),
    ).toBe(false);
  });

  it("does not flag a same-day summary", () => {
    expect(
      summaryPredatesMeeting({
        generated_at: "2026-08-25T23:00:00Z",
        meeting_date: "2026-08-25",
      }),
    ).toBe(false);
  });

  it("does not flag when either field is missing", () => {
    expect(summaryPredatesMeeting({ meeting_date: "2026-08-25" })).toBe(false);
    expect(summaryPredatesMeeting({ generated_at: "2026-08-22T00:00:00Z" })).toBe(false);
    expect(summaryPredatesMeeting({})).toBe(false);
  });
});

describe("creation defers meetings that have not happened", () => {
  it("defers the Aug 25 meeting on Aug 22", () => {
    expect(shouldDefer("2026-08-25", "2026-08-22")).toBe(true);
  });

  it("summarizes it the day after", () => {
    expect(shouldDefer("2026-08-25", "2026-08-26")).toBe(false);
  });

  it("summarizes on the day itself", () => {
    expect(shouldDefer("2026-08-25", "2026-08-25")).toBe(false);
  });

  it("never defers a past meeting", () => {
    expect(shouldDefer("2026-06-09", "2026-08-27")).toBe(false);
  });
});

describe("upgrade trigger", () => {
  const stale = { generated_at: "2026-08-22T11:31:00Z", meeting_date: "2026-08-25" };
  const fresh = { generated_at: "2026-08-26T12:00:00Z", meeting_date: "2026-08-25" };

  it("upgrades a stale summary when a recording appears — the case that was missed", () => {
    expect(
      shouldUpgrade(
        { source_minutes_url: null, source_video_url: "https://youtu.be/-clkKd5uaZA" },
        stale,
      ),
    ).toBe(true);
  });

  it("still upgrades when minutes appear", () => {
    expect(
      shouldUpgrade({ source_minutes_url: "https://x.test/m.pdf", source_video_url: null }, fresh),
    ).toBe(true);
  });

  it("does NOT re-summarize a fresh summary just because a recording exists", () => {
    // Otherwise every run would re-summarize every meeting that has a video,
    // burning the per-run budget and resetting review state forever.
    expect(
      shouldUpgrade(
        { source_minutes_url: null, source_video_url: "https://youtu.be/abc" },
        fresh,
      ),
    ).toBe(false);
  });

  it("does nothing when the entry has neither minutes nor a recording", () => {
    expect(shouldUpgrade({ source_minutes_url: null, source_video_url: null }, stale)).toBe(false);
  });
});
