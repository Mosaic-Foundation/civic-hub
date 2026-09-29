// civic.meeting_summary module — when a meeting is ready to summarize, and
// whether the summary that came out is fit to publish unreviewed.
//
// WHY THIS FILE EXISTS (2026-09-29)
// The 2026-09-22 Regular Meeting was summarized at 11:30 UTC ON the meeting
// day — 7:30 in the morning, before the meeting was held. The county's listing
// already carried the agenda and the YouTube link for the scheduled livestream,
// so the run had "a video" with no transcript behind it. The transcript was
// optional, the pipeline fell back to the agenda without saying so, and the
// summary came out describing planned topics with a video link and no
// timestamps. Nothing revisited it: the staleness rule treated a same-day
// summary as written after the meeting.
//
// Adam's rule since then: accuracy and stability over timeliness. A summary is
// written only from a record of the meeting — official minutes, or a
// transcript with timings — and never on or before the meeting date. A meeting
// that is not ready yet is WAITING, not failed; it is retried every run and
// reported once it has waited longer than anyone should expect.
//
// Pure functions only; the controller and the tests share them.

import type { SummaryBlock, TranscriptSegment } from "./models.js";

/**
 * How long a meeting may wait for its missing record before the run reports
 * it. Floyd posts recordings within a day and minutes within about four weeks;
 * two weeks without a transcript for a listed video means something is wrong
 * (captions off, provider failing), and that is worth an admin's attention.
 */
export const RECORD_GRACE_DAYS = 14;

export type SummaryQualityFlagKind = "timestamps_missing" | "transcript_unavailable";

/**
 * Why a summary must not be published without an admin looking at it first.
 * Stored on the summary (and on a waiting revision); cleared when the summary
 * is regenerated cleanly or the admin edits timestamps in.
 */
export interface SummaryQualityFlag {
  kind: SummaryQualityFlagKind;
  /** Admin-facing, one line, shown in the review screen and the digest. */
  message: string;
  /** Provider error or other detail, when there is one. */
  detail: string | null;
  /** ISO 8601. */
  flagged_at: string;
}

export const FLAG_MESSAGES: Readonly<Record<SummaryQualityFlagKind, string>> = {
  timestamps_missing:
    "No video timestamps; the transcript had timings, check before publishing",
  transcript_unavailable:
    "No video timestamps; the video's transcript could not be read, check before publishing",
};

export function qualityFlag(
  kind: SummaryQualityFlagKind,
  detail: string | null = null,
  now: string = new Date().toISOString(),
): SummaryQualityFlag {
  return { kind, message: FLAG_MESSAGES[kind], detail, flagged_at: now };
}

/**
 * Thrown by summarizeMeeting when the meeting has no usable record yet. Not a
 * failure: the run counts it as waiting and tries again next time.
 */
export class MeetingNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeetingNotReadyError";
  }
}

export function isMeetingNotReady(err: unknown): err is MeetingNotReadyError {
  return err instanceof MeetingNotReadyError;
}

/**
 * Today's calendar date, UTC. Meeting dates carry no time zone; comparing
 * against UTC is at most a few hours conservative for a US hub, which is the
 * safe direction.
 */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Has the meeting happened, with a day's margin? Strictly before today: a
 * meeting dated today may not have been held yet (the 2026-09-22 case), and a
 * summary written a day late costs nothing.
 */
export function meetingHasHappened(meetingDate: string, today: string): boolean {
  return meetingDate < today;
}

/** Whole days from the meeting date to today; negative before it. */
export function daysSinceMeeting(meetingDate: string, today: string): number {
  const a = Date.parse(`${meetingDate}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86_400_000);
}

/**
 * A summary is stale when it was generated on or before the day of the meeting
 * it describes. Same-day counts: the cron runs in the morning, US time, and a
 * summary written that morning predates the meeting.
 */
export function summaryPredatesMeeting(state: {
  generated_at?: string;
  meeting_date?: string;
}): boolean {
  const generated = (state.generated_at ?? "").slice(0, 10);
  const meeting = state.meeting_date ?? "";
  if (!generated || !meeting) return false;
  return generated <= meeting;
}

/**
 * Does the transcript carry real timings? At least two segments at different
 * offsets. A provider that returns plain text, or one segment, or everything
 * at zero, gives the model nothing to ground a timestamp against.
 */
export function isTimedTranscript(segments: readonly TranscriptSegment[]): boolean {
  if (segments.length < 2) return false;
  const starts = new Set(segments.map((s) => s.start));
  return starts.size > 1 && Math.max(...segments.map((s) => s.start)) > 0;
}

/** Does at least one block point into the video? */
export function blocksHaveTimestamps(blocks: readonly SummaryBlock[]): boolean {
  return blocks.some((b) => typeof b.start_time_seconds === "number");
}
