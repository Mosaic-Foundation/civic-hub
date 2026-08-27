// Revisions — reviewing a better summary without taking the live one down.
//
// Better sources arrive late: a jurisdiction publishes the recording within a
// day and the official minutes 15-30 days later. The improved summary must
// still be reviewed before residents see it. The obvious implementation —
// flip the record back to "pending" — is the one that must not be used: an
// unpublished summary serves nothing, so the live page would 404 for as long
// as the queue went untouched. That happened in production.
//
// So the published version stays put and the candidate waits beside it.

import { describe, it, expect } from "vitest";
import {
  acceptRevision,
  discardRevision,
  stageRevision,
} from "../../src/modules/civic.meeting_summary/service.js";
import type {
  MeetingSummaryProcessState,
  MeetingSummaryRevision,
} from "../../src/modules/civic.meeting_summary/models.js";

function published(): MeetingSummaryProcessState {
  return {
    type: "civic.meeting_summary",
    source_id: "wix:2017Agenda:2026-08-25:regular-meeting",
    source_minutes_url: null,
    source_agenda_url: "https://x.test/_files/ugd/a_1.pdf",
    source_type: "recording",
    source_video_url: "https://www.youtube.com/watch?v=-clkKd5uaZA",
    additional_video_urls: [],
    meeting_title: "Regular Meeting",
    meeting_date: "2026-08-25",
    blocks: [
      { topic_title: "Roads", topic_summary: "v1", start_time_seconds: 60, action_taken: null },
    ],
    approval_status: "published",
    generated_at: "2026-08-26T12:00:00Z",
    approved_at: "2026-08-26T13:00:00Z",
    published_at: "2026-08-26T13:00:00Z",
    admin_notes: "",
    last_edited_at: null,
    edit_count: 0,
    pending_revision: null,
    revised_at: null,
    ai_instructions_used: "…",
    ai_model: "claude-sonnet-4-6",
    ai_attribution_label: "AI-generated, admin-reviewed",
  };
}

const revision: MeetingSummaryRevision = {
  blocks: [
    { topic_title: "Roads", topic_summary: "v2", start_time_seconds: 60, action_taken: "Approved 5-0" },
    { topic_title: "Budget", topic_summary: "v2", start_time_seconds: 900, action_taken: null },
  ],
  source_minutes_url: "https://x.test/_files/ugd/m_9.pdf",
  source_agenda_url: "https://x.test/_files/ugd/a_1.pdf",
  source_type: "minutes",
  reason: "Official minutes have been published for this meeting.",
  ai_instructions_used: "…",
  ai_model: "claude-sonnet-4-6",
  generated_at: "2026-09-15T09:00:00Z",
};

describe("staging a revision", () => {
  it("leaves the published summary completely untouched", () => {
    const s = published();
    stageRevision(s, revision);
    expect(s.approval_status).toBe("published");
    expect(s.published_at).toBe("2026-08-26T13:00:00Z");
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0].topic_summary).toBe("v1");
    expect(s.source_minutes_url).toBeNull();
  });

  it("keeps the live page servable while a revision waits", () => {
    // The whole point: approval_status stays "published", so
    // getPublicReadModel keeps returning the summary.
    const s = published();
    stageRevision(s, revision);
    expect(s.approval_status).toBe("published");
  });

  it("supersedes an older waiting revision rather than queueing both", () => {
    const s = published();
    stageRevision(s, revision);
    stageRevision(s, { ...revision, generated_at: "2026-09-20T09:00:00Z" });
    expect(s.pending_revision?.generated_at).toBe("2026-09-20T09:00:00Z");
  });
});

describe("accepting a revision", () => {
  it("swaps the content in and records when", () => {
    const s = published();
    stageRevision(s, revision);
    acceptRevision(s, "2026-09-16T10:00:00Z");
    expect(s.blocks).toHaveLength(2);
    expect(s.blocks[0].action_taken).toBe("Approved 5-0");
    expect(s.source_minutes_url).toBe("https://x.test/_files/ugd/m_9.pdf");
    expect(s.source_type).toBe("minutes");
    expect(s.revised_at).toBe("2026-09-16T10:00:00Z");
    expect(s.pending_revision).toBeNull();
  });

  it("never disturbs publication state — no 404 window, no second publish", () => {
    const s = published();
    stageRevision(s, revision);
    acceptRevision(s);
    expect(s.approval_status).toBe("published");
    expect(s.published_at).toBe("2026-08-26T13:00:00Z");
  });

  it("throws when nothing is waiting", () => {
    expect(() => acceptRevision(published())).toThrow(/No revision/);
  });
});

describe("discarding a revision", () => {
  it("leaves the published summary exactly as it was", () => {
    const s = published();
    stageRevision(s, revision);
    discardRevision(s);
    expect(s.pending_revision).toBeNull();
    expect(s.blocks[0].topic_summary).toBe("v1");
    expect(s.source_minutes_url).toBeNull();
    expect(s.approval_status).toBe("published");
    expect(s.revised_at).toBeNull();
  });

  it("throws when nothing is waiting", () => {
    expect(() => discardRevision(published())).toThrow(/No revision/);
  });
});

describe("the reader-facing flags", () => {
  it("awaiting_minutes is true until minutes land, false after", () => {
    const s = published();
    expect(!s.source_minutes_url).toBe(true);
    stageRevision(s, revision);
    acceptRevision(s);
    expect(!s.source_minutes_url).toBe(false);
  });

  it("revised_at stays null for a summary that was never revised", () => {
    expect(published().revised_at).toBeNull();
  });
});
