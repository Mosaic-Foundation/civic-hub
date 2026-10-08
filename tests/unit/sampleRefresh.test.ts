// Samples for every kind of hub, kept current (2026-10-07, session 3b; review
// R18, issue #9, R25). Pure: the templates, the refresh rule, the job's
// description of a run, and the Code of Conduct gate for demo publishing.
// The database half (replacing, the button, mode checks, removal counts) is
// tests/api/sampleRefresh.test.ts.

import { describe, it, expect } from "vitest";
import { SAMPLE_TEMPLATES, templatesFor, type SampleTemplate } from "../../src/services/sampleTemplates.js";
import { REFRESH_WINDOW_DAYS, refreshReason } from "../../src/services/sampleRefresh.js";
import { describeJobRun } from "../../src/jobs/describe.js";
import { draftPassedCodeOfConduct } from "../../src/modules/civic.review/service.js";
import { CHECK_UNAVAILABLE_RESULT } from "../../src/modules/civic.assistant/index.js";
import { JURISDICTION_TYPES } from "../../src/shared/jurisdictionType.js";

const DAY = 24 * 60 * 60 * 1000;

/** What a demo hub must always show, from the templates it is seeded with. */
function mix(ts: SampleTemplate[]) {
  const votes = ts.filter((t) => t.kind === "vote");
  return {
    open: votes.some((t) => t.kind === "vote" && t.phase === "open"),
    endorsing: votes.some((t) => t.kind === "vote" && t.phase === "proposed"),
    closedWithOutcome: votes.some(
      (t) => t.kind === "vote" && t.phase === "closed" && ts.some((o) => o.kind === "outcome" && o.source === t.key),
    ),
    proposal: ts.some((t) => t.kind === "proposal"),
    conversation: ts.some((t) => t.kind === "deliberation"),
  };
}

const ALL = { open: true, endorsing: true, closedWithOutcome: true, proposal: true, conversation: true };

describe("samples for every kind of hub", () => {
  it("gives every place type and every other kind the required mix", () => {
    for (const t of JURISDICTION_TYPES.map((x) => x.id)) expect(mix(templatesFor(t, "place")), t).toEqual(ALL);
    for (const k of ["organization", "issue", "other"] as const) expect(mix(templatesFor(null, k)), k).toEqual(ALL);
  });

  it("spreads each kind's set across the plugin types", () => {
    const kinds = (ts: SampleTemplate[]) => new Set(ts.map((t) => t.kind));
    const every = ["vote", "outcome", "proposal", "deliberation", "project", "announcement", "meeting_summary", "wordcloud"];
    expect([...kinds(templatesFor("county"))].sort()).toEqual([...every].sort());
    expect([...kinds(templatesFor("school_district"))].sort()).toEqual([...every].sort());
    expect([...kinds(templatesFor(null, "organization"))].sort()).toEqual([...every].sort());
    expect([...kinds(templatesFor(null, "issue"))].sort()).toEqual([...every].sort());
  });

  it("names no place or governing body in a set for a hub without one", () => {
    for (const t of SAMPLE_TEMPLATES) {
      if (t.kinds.includes("place")) continue;
      expect(JSON.stringify(t), t.key).not.toMatch(/\{(JURISDICTION|GOVERNING_BODY)\}/);
      expect(JSON.stringify(t), t.key).not.toMatch(/\bresidents?\b/i);
    }
  });

  it("gives every sample meeting summary minutes to read (issue #7)", () => {
    for (const t of SAMPLE_TEMPLATES) {
      if (t.kind !== "meeting_summary") continue;
      expect(t.minutes.split(/\n\s*\n/).length, t.key).toBeGreaterThanOrEqual(4);
      // Every section the summary lists is in the minutes too.
      for (const b of t.blocks) expect(t.minutes, `${t.key}: ${b.title}`).toContain(b.title.split(":")[0]);
    }
  });

  it("uses unique keys", () => {
    const keys = SAMPLE_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("when a live sample is replaced", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const inDays = (d: number) => new Date(now.getTime() + d * DAY).toISOString();
  const open = templatesFor("county").find((t) => t.kind === "vote" && t.phase === "open")!;
  const endorsing = templatesFor("county").find((t) => t.kind === "vote" && t.phase === "proposed")!;
  const proposal = templatesFor("county").find((t) => t.kind === "proposal")!;
  const conversation = templatesFor("county").find((t) => t.kind === "deliberation")!;
  const row = (status: string, state: Record<string, unknown> = {}) => ({ id: "p", status, state });

  it("replaces an open vote within the window, or one that has closed", () => {
    expect(refreshReason(open, row("active", { voting_closes_at: inDays(REFRESH_WINDOW_DAYS + 1) }), null, now)).toBeNull();
    expect(refreshReason(open, row("active", { voting_closes_at: inDays(REFRESH_WINDOW_DAYS - 1) }), null, now)).toMatch(/window/);
    expect(refreshReason(open, row("closed", { voting_closes_at: inDays(-1) }), null, now)).toMatch(/no longer open/);
  });

  it("replaces the endorsement vote only once it has left that phase", () => {
    expect(refreshReason(endorsing, row("proposed"), null, now)).toBeNull();
    expect(refreshReason(endorsing, row("active"), null, now)).toMatch(/endorsements/);
  });

  it("reads a proposal's own closes_at, and a conversation's deadline", () => {
    expect(refreshReason(proposal, row("active"), inDays(10), now)).toBeNull();
    expect(refreshReason(proposal, row("active"), inDays(2), now)).toMatch(/window/);
    expect(refreshReason(conversation, row("active", { deadline: inDays(30) }), null, now)).toBeNull();
    expect(refreshReason(conversation, row("active", { deadline: inDays(1) }), null, now)).toMatch(/window/);
  });

  it("never replaces what it is not there to keep live", () => {
    for (const t of templatesFor("county")) {
      if (t.kind === "vote" && t.phase !== "closed") continue;
      if (t.kind === "proposal" || t.kind === "deliberation") continue;
      expect(refreshReason(t, row("closed"), null, now), t.key).toBeNull();
    }
  });
});

describe("the sample refresh's run log", () => {
  const outcome = (body: Record<string, unknown>) => ({ status: 200, body });

  it("records nothing for a hub that is not a demo, or with nothing to do", () => {
    expect(describeJobRun("sample_refresh", outcome({ skipped: "not a demo hub (live)", replaced: [], added: [], minutes_added: [] }))).toBeNull();
    expect(describeJobRun("sample_refresh", outcome({ replaced: [], added: [], minutes_added: [] }))).toBeNull();
  });

  it("says what it replaced and added", () => {
    const run = describeJobRun(
      "sample_refresh",
      outcome({ replaced: [{ key: "vote_internet", reason: "x" }], added: ["a", "b"], minutes_added: [] }),
    );
    expect(run).toEqual({ status: "ok", summary: "1 sample replaced with a fresh copy; 2 missing samples added", problems: [] });
  });
});

describe("the Code of Conduct gate for demo publishing", () => {
  it("passes only a draft the check ran on, found nothing in, and that has not changed", () => {
    expect(draftPassedCodeOfConduct({ last_review_result: [], draft_modified_since_review: false })).toBe(true);
    // Never run.
    expect(draftPassedCodeOfConduct({ last_review_result: null, draft_modified_since_review: false })).toBe(false);
    // The checker was unavailable: stored as such (submitting stays allowed).
    expect(
      draftPassedCodeOfConduct({ last_review_result: [{ ...CHECK_UNAVAILABLE_RESULT }], draft_modified_since_review: false }),
    ).toBe(false);
    expect(draftPassedCodeOfConduct({ last_review_result: [], draft_modified_since_review: true })).toBe(false);
    expect(draftPassedCodeOfConduct({ last_review_result: [{ severity: "hard" }], draft_modified_since_review: false })).toBe(false);
    expect(draftPassedCodeOfConduct({ last_review_result: [{ severity: "soft" }], draft_modified_since_review: false })).toBe(true);
  });
});
