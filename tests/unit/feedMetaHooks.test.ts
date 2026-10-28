/**
 * The feed card fields each type's handler maps from its public read model
 * (ProcessHandler.feedMeta; Architecture 2 moved them out of
 * src/services/feedMeta.ts's switch). The word cloud's head-count reads the
 * database and is not covered here.
 */
import { describe, it, expect } from "vitest";
import { getProcessHandler } from "../../src/processes/registry.js";

function meta(type: string, model: Record<string, unknown>) {
  return getProcessHandler(type)?.feedMeta?.({ type, ...model }, "p1");
}

describe("feedMeta hooks", () => {
  it("vote: title, description, and null results stay unknown", () => {
    expect(meta("civic.vote", { title: "T", description: "D", total_votes: 3 })).toEqual({
      title: "T",
      description: "D",
      totalVotes: 3,
    });
    expect(meta("civic.vote", { title: "T", total_votes: null })).toEqual({
      title: "T",
      description: undefined,
      totalVotes: undefined,
    });
  });

  it("vote results: retired as a type (engine 2, C), so no handler maps its card", () => {
    // A converted record is a brief now; an old event's card comes from the
    // manifest's legacyTypes, not from a handler (see feedWire).
    expect(meta("civic.vote_results", { title: "T", admin_notes: "N", comments: [1, 2] })).toBeUndefined();
  });

  it("meeting summary: block count and the latest start", () => {
    expect(
      meta("civic.meeting_summary", {
        meeting_title: "M",
        blocks: [{ start_time_seconds: 5 }, { start_time_seconds: 90 }, {}],
      }),
    ).toEqual({ title: "M", blockCount: 3, maxStartSeconds: 90 });
    expect(meta("civic.meeting_summary", { meeting_title: "M" })).toEqual({
      title: "M",
      blockCount: 0,
      maxStartSeconds: null,
    });
  });

  it("brief: headline, and revised once a regenerated version replaced it", () => {
    expect(meta("civic.brief", { title: "T", headline: "H", revised_at: "2026-10-01" })).toEqual({
      title: "T",
      description: "H",
      lastEditedAt: "2026-10-01",
      editCount: 1,
    });
    expect(meta("civic.brief", { title: "T", headline: "H" })).toMatchObject({ lastEditedAt: null, editCount: 0 });
  });

  it("project: banner as the image", () => {
    expect(
      meta("civic.project", { title: "T", description: "D", banner_image_url: "u", banner_image_alt: "a" }),
    ).toEqual({ title: "T", description: "D", imageUrl: "u", imageAlt: "a" });
  });

  it("conversation: topic and framing stand in for title and description", () => {
    expect(meta("civic.polis_deliberation", { topic: "Topic", framing: "Frame" })).toEqual({
      title: "Topic",
      description: "Frame",
    });
    expect(meta("civic.polis_deliberation", { title: "T", description: "D", topic: "x" })).toEqual({
      title: "T",
      description: "D",
    });
  });

  it("announcement: edit state and removal", () => {
    expect(
      meta("civic.announcement", { title: "T", body: "B", edit_count: 2, moderation: { removed: true } }),
    ).toEqual({
      title: "T",
      description: "B",
      imageUrl: null,
      imageAlt: null,
      editCount: 2,
      lastEditedAt: null,
      removed: true,
    });
  });

  it("proposal has no hook", () => {
    expect(getProcessHandler("civic.proposal")?.feedMeta).toBeUndefined();
  });
});
