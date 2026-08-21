// Unit tests for the transcript-only summarization path.
//
// A YouTube channel feed carries no minutes or agenda PDF, so summarizeMeeting
// had to learn to work from the transcript alone. Before this change it threw
// "No PDF available" on any entry without a document — which would have made
// the new connector useless.

import { describe, it, expect, vi } from "vitest";
import { summarizeMeeting } from "../../src/modules/civic.meeting_summary/pipeline.js";
import type {
  MeetingEntry,
  MeetingSummaryConfig,
} from "../../src/modules/civic.meeting_summary/models.js";

const cfg: MeetingSummaryConfig = {
  source_url: "",
  channel_id: "UCxyzO8F2UfiN1NVOax2s27Q",
  title_filter: "Board of Supervisors",
  extraction_instructions: "",
  model: "claude-sonnet-4-6",
};

const recordingOnly: MeetingEntry = {
  meeting_title: "Floyd County Board of Supervisors Regular Meeting",
  meeting_date: "2026-08-11",
  source_minutes_url: null,
  source_agenda_url: null,
  source_video_url: "https://www.youtube.com/watch?v=mm9_HIvBBlU",
  additional_video_urls: [],
  source_id: "youtube:UCxyzO8F2UfiN1NVOax2s27Q:2026-08-11:floyd-county-board-of-supervisors-regular-meeting",
};

const BLOCKS_JSON = JSON.stringify({
  blocks: [
    {
      topic_title: "Broadband expansion update",
      topic_summary: "The board heard a progress report on the fiber build-out.",
      start_time_seconds: 420,
      action_taken: null,
    },
  ],
});

function deps(overrides: Partial<Parameters<typeof summarizeMeeting>[2]> = {}) {
  return {
    fetchPdf: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: "application/pdf" })),
    fetchYouTubeTranscript: vi.fn(async () => [
      { start: 0, text: "Call to order." },
      { start: 420, text: "Next item is the broadband expansion update." },
    ]),
    callClaude: vi.fn(async () => ({ text: BLOCKS_JSON, model: "claude-sonnet-4-6" })),
    ...overrides,
  };
}

describe("summarizeMeeting — transcript-only meetings", () => {
  it("summarizes an entry with no PDF at all", async () => {
    const d = deps();
    const result = await summarizeMeeting(recordingOnly, cfg, d);
    expect(result.sourceType).toBe("recording");
    expect(result.blocks).toHaveLength(1);
    expect(d.fetchPdf).not.toHaveBeenCalled();
  });

  it("sends no document block to Claude when there is no PDF", async () => {
    const d = deps();
    await summarizeMeeting(recordingOnly, cfg, d);
    const call = d.callClaude.mock.calls[0][0] as Record<string, unknown>;
    expect(call.documentBase64).toBeUndefined();
  });

  it("keeps transcript timestamps so blocks stay clickable", async () => {
    const result = await summarizeMeeting(recordingOnly, cfg, deps());
    expect(result.blocks[0].start_time_seconds).toBe(420);
  });

  it("fails loudly when the transcript is empty and there is no PDF to fall back on", async () => {
    // Summarizing nothing produces invented blocks, which is worse than a
    // failed meeting — the whole point of the record is that it's accurate.
    const d = deps({ fetchYouTubeTranscript: vi.fn(async () => []) });
    await expect(summarizeMeeting(recordingOnly, cfg, d)).rejects.toThrow(/No transcript available/);
    expect(d.callClaude).not.toHaveBeenCalled();
  });

  it("fails loudly when the transcript provider errors and there is no PDF", async () => {
    const d = deps({
      fetchYouTubeTranscript: vi.fn(async () => {
        throw new Error("Supadata 429: rate limited");
      }),
    });
    await expect(summarizeMeeting(recordingOnly, cfg, d)).rejects.toThrow(/nothing to summarize/i);
  });

  it("rejects an entry with no document and no recording", async () => {
    const empty = { ...recordingOnly, source_video_url: null };
    await expect(summarizeMeeting(empty, cfg, deps())).rejects.toThrow(/Nothing to summarize/);
  });
});

describe("summarizeMeeting — document-backed meetings still work", () => {
  it("still prefers minutes and attaches the PDF", async () => {
    const withMinutes: MeetingEntry = {
      ...recordingOnly,
      source_minutes_url: "https://www.floydcova.gov/_files/ugd/db2c48_abc.pdf",
    };
    const d = deps();
    const result = await summarizeMeeting(withMinutes, cfg, d);
    expect(result.sourceType).toBe("minutes");
    expect(d.fetchPdf).toHaveBeenCalledWith(withMinutes.source_minutes_url);
    const call = d.callClaude.mock.calls[0][0] as Record<string, unknown>;
    expect(call.documentBase64).toBeDefined();
  });

  it("falls back to PDF-only when the transcript fails but an agenda exists", async () => {
    const withAgenda: MeetingEntry = {
      ...recordingOnly,
      source_agenda_url: "https://www.floydcova.gov/_files/ugd/db2c48_def.pdf",
    };
    const d = deps({
      fetchYouTubeTranscript: vi.fn(async () => {
        throw new Error("Supadata 429");
      }),
    });
    const result = await summarizeMeeting(withAgenda, cfg, d);
    expect(result.sourceType).toBe("agenda");
    expect(result.blocks).toHaveLength(1);
  });
});
