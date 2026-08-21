// Block-count guidance, scaled to how long the meeting actually ran.
//
// The original prompt said "Aim for 4–12 blocks per meeting" regardless of
// length. On Floyd's 4h24m August 2026 meeting that caused real content loss:
// one run obeyed it (13 blocks) and silently dropped the final hour including
// the County Administrator's report; a second run of the same transcript
// exceeded it (16 blocks), covered more, and dropped the closed session
// instead. Neither run covered the whole meeting.

import { describe, it, expect } from "vitest";
import {
  blockCountGuidance,
  buildSummarizationPrompt,
} from "../../src/modules/civic.meeting_summary/prompts.js";

const base = {
  extraction_instructions: "",
  meeting_title: "Regular Meeting",
  meeting_date: "2026-08-11",
  transcript_text: "[00:00] Call to order.",
  has_video: true,
  source_type: "agenda" as const,
};

describe("blockCountGuidance", () => {
  it("asks for far more blocks on a four-hour meeting than the old fixed range", () => {
    // Floyd's 2026-08-11 meeting: 4h24m.
    const g = blockCountGuidance(4 * 3600 + 24 * 60)!;
    expect(g.min).toBeGreaterThan(12);
    expect(g.max).toBeGreaterThan(20);
  });

  it("keeps a typical 90-minute meeting near the original range", () => {
    const g = blockCountGuidance(90 * 60)!;
    expect(g.min).toBeGreaterThanOrEqual(4);
    expect(g.max).toBeLessThanOrEqual(12);
  });

  it("floors short meetings so they still get a useful breakdown", () => {
    const g = blockCountGuidance(10 * 60)!;
    expect(g.min).toBe(4);
    expect(g.max).toBe(8);
  });

  it("caps marathon meetings so the summary does not become a transcript", () => {
    const g = blockCountGuidance(12 * 3600)!;
    expect(g.min).toBeLessThanOrEqual(20);
    expect(g.max).toBeLessThanOrEqual(40);
  });

  it("always yields a sane, increasing range", () => {
    for (const minutes of [5, 30, 60, 90, 150, 264, 400, 720]) {
      const g = blockCountGuidance(minutes * 60)!;
      expect(g.min).toBeLessThan(g.max);
      expect(g.min).toBeGreaterThanOrEqual(4);
    }
  });

  it("returns null when the duration is unknown", () => {
    expect(blockCountGuidance(null)).toBeNull();
    expect(blockCountGuidance(undefined)).toBeNull();
    expect(blockCountGuidance(0)).toBeNull();
    expect(blockCountGuidance(-1)).toBeNull();
    expect(blockCountGuidance(Number.NaN)).toBeNull();
  });
});

describe("buildSummarizationPrompt — coverage instructions", () => {
  it("states the meeting length and a scaled block target", () => {
    const p = buildSummarizationPrompt({
      ...base,
      transcript_duration_seconds: 4 * 3600 + 24 * 60,
    });
    expect(p).toContain("264 minutes");
    expect(p).not.toContain("Aim for 4–12 blocks per meeting.");
  });

  it("falls back to the fixed range when there is no transcript", () => {
    const p = buildSummarizationPrompt({
      ...base,
      has_video: false,
      transcript_duration_seconds: null,
    });
    expect(p).toContain("Aim for 4–12 blocks per meeting.");
  });

  it("tells the model to cover through to adjournment", () => {
    // Directly targets the run that stopped at 3:12 of a 4:24 meeting.
    const p = buildSummarizationPrompt({ ...base, transcript_duration_seconds: 3600 });
    expect(p).toContain("COVER THE WHOLE MEETING");
    expect(p).toContain("adjournment");
  });

  it("requires closed sessions to be recorded", () => {
    // Directly targets the run that omitted the FOIA closed session and its
    // certification vote — a material governance event.
    const p = buildSummarizationPrompt({ ...base, transcript_duration_seconds: 3600 });
    expect(p).toContain("Never omit a closed session");
    expect(p).toContain("certification vote");
  });

  it("still keeps the procedural-noise exclusion", () => {
    const p = buildSummarizationPrompt({ ...base, transcript_duration_seconds: 3600 });
    expect(p).toContain("Skip procedural micro-items");
  });
});
