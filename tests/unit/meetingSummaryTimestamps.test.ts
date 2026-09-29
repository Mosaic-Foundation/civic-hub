// Meeting summaries and video timestamps (2026-09-29).
//
// THE BUG THESE EXIST FOR
// The 2026-09-22 Regular Meeting was summarized at 11:30 UTC on the meeting
// day — before the meeting was held. The county's listing already carried the
// agenda and the livestream's YouTube link, the transcript came back empty,
// and the pipeline quietly fell back to the agenda: a summary with a video
// link and not one timestamp, which nothing flagged and nothing revisited.
//
// The rules pinned here (src/modules/civic.meeting_summary/readiness.ts):
//   - a summary is written only from a record: minutes, or a timed transcript;
//   - a listed video without a usable timed transcript means WAIT, not "skip
//     the transcript";
//   - a summary built from a timed transcript comes out with timestamps, or
//     is retried once and then flagged;
//   - a flagged summary is never published without an admin confirming.

import { describe, it, expect, vi } from "vitest";
import { summarizeMeeting } from "../../src/modules/civic.meeting_summary/pipeline.js";
import {
  FLAG_MESSAGES,
  isMeetingNotReady,
  isTimedTranscript,
  meetingHasHappened,
  summaryPredatesMeeting,
} from "../../src/modules/civic.meeting_summary/readiness.js";
import {
  acceptRevision,
  approveMeetingSummary,
  createMeetingSummaryState,
  editMeetingSummary,
  effectiveQualityFlag,
  FlaggedSummaryError,
} from "../../src/modules/civic.meeting_summary/service.js";
import type {
  MeetingEntry,
  MeetingSummaryConfig,
  MeetingSummaryProcessState,
  SummaryBlock,
} from "../../src/modules/civic.meeting_summary/models.js";

const cfg: MeetingSummaryConfig = {
  source_url: "https://county.example/agendas-minutes",
  extraction_instructions: "",
  model: "claude-sonnet-4-6",
};

/** The 2026-09-22 shape: an agenda and a video, no minutes yet. */
const agendaAndVideo: MeetingEntry = {
  meeting_title: "Regular Meeting",
  meeting_date: "2026-09-22",
  source_minutes_url: null,
  source_agenda_url: "https://county.example/_files/ugd/agenda.pdf",
  source_video_url: "https://www.youtube.com/watch?v=Dw566TkDKfk",
  additional_video_urls: [],
  source_id: "wix:2017Agenda:2026-09-22:regular-meeting",
};

const withMinutes: MeetingEntry = {
  ...agendaAndVideo,
  source_minutes_url: "https://county.example/_files/ugd/minutes.pdf",
};

const TIMED = [
  { start: 31, text: "All righty. With that, I'll go ahead." },
  { start: 420, text: "Next item is the broadband expansion update." },
  { start: 1800, text: "Motion to adjourn." },
];

function blocksJson(start: number | null): string {
  return JSON.stringify({
    blocks: [
      {
        topic_title: "Broadband expansion update",
        topic_summary: "The board heard a progress report on the fiber build-out.",
        start_time_seconds: start,
        action_taken: null,
      },
      {
        topic_title: "Adjournment",
        topic_summary: "The meeting adjourned.",
        start_time_seconds: start === null ? null : 1800,
        action_taken: null,
      },
    ],
  });
}

function deps(overrides: Partial<Parameters<typeof summarizeMeeting>[2]> = {}) {
  return {
    fetchPdf: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: "application/pdf" })),
    fetchYouTubeTranscript: vi.fn(async () => TIMED),
    callClaude: vi.fn(async () => ({ text: blocksJson(420), model: "claude-sonnet-4-6" })),
    ...overrides,
  };
}

describe("a summary built from a timed transcript has timestamps", () => {
  it("keeps the model's timestamps and is not flagged", async () => {
    const d = deps();
    const result = await summarizeMeeting(agendaAndVideo, cfg, d);
    expect(result.blocks.map((b) => b.start_time_seconds)).toEqual([420, 1800]);
    expect(result.quality_flag).toBeNull();
    expect(d.callClaude).toHaveBeenCalledTimes(1);
  });

  it("asks once more when the model drops every timestamp, and keeps the good retry", async () => {
    const callClaude = vi
      .fn()
      .mockResolvedValueOnce({ text: blocksJson(null), model: "m" })
      .mockResolvedValueOnce({ text: blocksJson(420), model: "m" });
    const result = await summarizeMeeting(agendaAndVideo, cfg, deps({ callClaude }));
    expect(callClaude).toHaveBeenCalledTimes(2);
    // The retry restates the requirement.
    expect(String(callClaude.mock.calls[1][0].userText)).toMatch(/RETRY/);
    expect(result.blocks[0].start_time_seconds).toBe(420);
    expect(result.quality_flag).toBeNull();
  });

  it("flags the summary when the retry still has no timestamps — kept, not dropped", async () => {
    const callClaude = vi.fn(async () => ({ text: blocksJson(null), model: "m" }));
    const result = await summarizeMeeting(agendaAndVideo, cfg, deps({ callClaude }));
    expect(callClaude).toHaveBeenCalledTimes(2);
    expect(result.blocks).toHaveLength(2);
    expect(result.quality_flag?.kind).toBe("timestamps_missing");
    expect(result.quality_flag?.message).toBe(
      "No video timestamps; the transcript had timings, check before publishing",
    );
  });
});

describe("a meeting without a usable record waits", () => {
  it("waits when the listed video has no transcript yet — the 2026-09-22 case", async () => {
    const d = deps({ fetchYouTubeTranscript: vi.fn(async () => []) });
    const err = await summarizeMeeting(agendaAndVideo, cfg, d).catch((e) => e);
    expect(isMeetingNotReady(err)).toBe(true);
    expect(String(err.message)).toMatch(/transcript/);
    // Nothing is spent on a meeting that is not ready.
    expect(d.callClaude).not.toHaveBeenCalled();
    expect(d.fetchPdf).not.toHaveBeenCalled();
  });

  it("waits when the provider errors (e.g. Supadata still preparing an async job)", async () => {
    const d = deps({
      fetchYouTubeTranscript: vi.fn(async () => {
        throw new Error("Supadata is still preparing this transcript (asynchronous job abc)");
      }),
    });
    const err = await summarizeMeeting(agendaAndVideo, cfg, d).catch((e) => e);
    expect(isMeetingNotReady(err)).toBe(true);
    expect(d.callClaude).not.toHaveBeenCalled();
  });

  it("waits when the transcript has no timings", async () => {
    const untimed = [
      { start: 0, text: "Everything at zero." },
      { start: 0, text: "Still zero." },
    ];
    const d = deps({ fetchYouTubeTranscript: vi.fn(async () => untimed) });
    const err = await summarizeMeeting(agendaAndVideo, cfg, d).catch((e) => e);
    expect(isMeetingNotReady(err)).toBe(true);
  });

  it("never summarizes an agenda alone", async () => {
    const agendaOnly = { ...agendaAndVideo, source_video_url: null };
    const d = deps();
    const err = await summarizeMeeting(agendaOnly, cfg, d).catch((e) => e);
    expect(isMeetingNotReady(err)).toBe(true);
    expect(d.callClaude).not.toHaveBeenCalled();
  });

  it("still waits for the transcript when minutes exist, inside the grace period", async () => {
    const d = deps({ fetchYouTubeTranscript: vi.fn(async () => []) });
    const err = await summarizeMeeting(withMinutes, cfg, d).catch((e) => e);
    expect(isMeetingNotReady(err)).toBe(true);
  });

  it("past the grace period, minutes go ahead without the video — flagged", async () => {
    const d = deps({ fetchYouTubeTranscript: vi.fn(async () => []) });
    const result = await summarizeMeeting(withMinutes, cfg, d, { allowMissingTranscript: true });
    expect(result.sourceType).toBe("minutes");
    expect(result.quality_flag?.kind).toBe("transcript_unavailable");
    expect(result.quality_flag?.message).toBe(FLAG_MESSAGES.transcript_unavailable);
  });

  it("minutes with no video at all need no transcript and carry no flag", async () => {
    const minutesOnly = { ...withMinutes, source_video_url: null };
    const d = deps({ callClaude: vi.fn(async () => ({ text: blocksJson(null), model: "m" })) });
    const result = await summarizeMeeting(minutesOnly, cfg, d);
    expect(result.quality_flag).toBeNull();
    expect(d.fetchYouTubeTranscript).not.toHaveBeenCalled();
    expect(d.callClaude).toHaveBeenCalledTimes(1);
  });
});

describe("timing rules", () => {
  it("a meeting dated today has not happened yet; yesterday's has", () => {
    expect(meetingHasHappened("2026-09-22", "2026-09-22")).toBe(false);
    expect(meetingHasHappened("2026-09-22", "2026-09-23")).toBe(true);
  });

  it("a summary written on the meeting day predates the meeting", () => {
    expect(
      summaryPredatesMeeting({ generated_at: "2026-09-22T11:30:51Z", meeting_date: "2026-09-22" }),
    ).toBe(true);
    expect(
      summaryPredatesMeeting({ generated_at: "2026-09-23T11:30:00Z", meeting_date: "2026-09-22" }),
    ).toBe(false);
  });

  it("a timed transcript needs real, varied offsets", () => {
    expect(isTimedTranscript(TIMED)).toBe(true);
    expect(isTimedTranscript([{ start: 5, text: "one line" }])).toBe(false);
    expect(isTimedTranscript([])).toBe(false);
  });
});

// --- A flagged summary is never published silently ---------------------------

function flaggedState(): MeetingSummaryProcessState {
  const blocks: SummaryBlock[] = [
    { topic_title: "Budget", topic_summary: "Discussed.", start_time_seconds: null, action_taken: null },
  ];
  return createMeetingSummaryState({
    source_id: agendaAndVideo.source_id,
    source_minutes_url: null,
    source_agenda_url: agendaAndVideo.source_agenda_url,
    source_type: "agenda",
    source_video_url: agendaAndVideo.source_video_url,
    additional_video_urls: [],
    meeting_title: "Regular Meeting",
    meeting_date: "2026-09-22",
    blocks,
    ai_instructions_used: "",
    ai_model: "m",
    quality_flag: {
      kind: "timestamps_missing",
      message: FLAG_MESSAGES.timestamps_missing,
      detail: null,
      flagged_at: "2026-09-29T11:30:00Z",
    },
  });
}

const ctx = () => ({ process_id: "proc_1", jurisdiction: "us-va-test", emit: vi.fn(async () => ({})) });

describe("a missing-timestamps summary is flagged, not published", () => {
  it("refuses approval without confirmation, and publishes nothing", async () => {
    const state = flaggedState();
    const c = ctx();
    await expect(approveMeetingSummary(state, "system:cron", c)).rejects.toBeInstanceOf(
      FlaggedSummaryError,
    );
    expect(state.approval_status).toBe("pending");
    expect(state.published_at).toBeNull();
    expect(c.emit).not.toHaveBeenCalled();
  });

  it("publishes once an admin confirms", async () => {
    const state = flaggedState();
    await approveMeetingSummary(state, "admin", ctx(), { confirmFlagged: true });
    expect(state.approval_status).toBe("published");
  });

  it("clears the flag when an admin edits timestamps in", async () => {
    const state = flaggedState();
    await editMeetingSummary(
      state,
      "admin",
      {
        blocks: [
          { topic_title: "Budget", topic_summary: "Discussed.", start_time_seconds: 95, action_taken: null },
        ],
      },
      ctx(),
    );
    expect(state.quality_flag).toBeNull();
    await approveMeetingSummary(state, "admin", ctx());
    expect(state.approval_status).toBe("published");
  });

  it("treats an older summary with a video and no timestamps as flagged too", () => {
    const legacy = flaggedState();
    delete legacy.quality_flag;
    expect(effectiveQualityFlag(legacy)?.kind).toBe("transcript_unavailable");
    const noVideo = { ...legacy, source_video_url: null };
    expect(effectiveQualityFlag(noVideo)).toBeNull();
  });

  it("refuses to accept a flagged revision without confirmation", () => {
    const state = flaggedState();
    state.quality_flag = null;
    state.blocks[0].start_time_seconds = 60;
    state.pending_revision = {
      blocks: [{ topic_title: "X", topic_summary: "Y", start_time_seconds: null, action_taken: null }],
      source_minutes_url: "https://county.example/m.pdf",
      source_agenda_url: null,
      source_video_url: agendaAndVideo.source_video_url,
      additional_video_urls: [],
      source_type: "minutes",
      reason: "Official minutes have been published for this meeting.",
      ai_instructions_used: "",
      ai_model: "m",
      generated_at: "2026-10-20T11:30:00Z",
      quality_flag: flaggedState().quality_flag,
    };
    expect(() => acceptRevision(state)).toThrow(FlaggedSummaryError);
    acceptRevision(state, undefined, { confirmFlagged: true });
    expect(state.quality_flag?.kind).toBe("timestamps_missing");
  });
});
