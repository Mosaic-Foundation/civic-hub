// The summary move (plugin session 2, ADR-015): a conversation hands its brief
// the result as data, and the brief writes the summary with the AI under its
// own grant. Without the AI (this hub has not allowed briefs to use it, or the
// model failed) the brief is still made, with the result's own figures and the
// reason the text is missing.

import { describe, expect, it } from "vitest";
import { briefHost } from "../../packages/civic.brief/host.js";
import { deliberationSummary, finalizeBriefContent } from "../../packages/civic.brief/finalize.js";
import BRIEF_MANIFEST from "../../packages/civic.brief/manifest.js";
import POLIS_DELIBERATION_MANIFEST from "../../packages/civic.polis_deliberation/manifest.js";
import type { BriefContent, DeliberationResult, PluginHost } from "../../src/sdk/index.js";

const RESULT: DeliberationResult = {
  kind: "deliberation",
  topic: "The river path",
  data_uri: "https://polis.example/c1",
  participant_count: 12,
  statement_count: 4,
  groups: [{ id: 0, size: 7, representative_statements: [{ text: "Light it at night", repness: 0.8, direction: "agree" }] }],
  consensus: { agree: [{ statement_id: 1, text: "Keep it open", agree_rate: 0.9, vote_count: 11 }], disagree: [] },
  statements: [{ id: 1, text: "Keep it open" }],
};

const AI_JSON = JSON.stringify({
  summary_text: "Residents want the path kept open.",
  directed_questions: ["When will it be lit?"],
  top_consensus_statements: [{ statement_text: "Keep it open", agree_rate: 0.9, vote_count: 11 }],
});

function bindHost(opts: { allows: boolean; reply?: string | Error; calls?: string[] }) {
  briefHost.bind({
    packageName: "@civic-social/plugin-brief",
    db: () => {
      throw new Error("not used");
    },
    allows: () => opts.allows,
    adapter: (() => ({
      defaultModel: () => "fake-model",
      async complete(purpose: string) {
        opts.calls?.push(purpose);
        if (opts.reply instanceof Error) throw opts.reply;
        return { text: opts.reply ?? AI_JSON, model: "fake-model", usage: { input_tokens: 1, output_tokens: 1 } };
      },
    })) as never,
  } satisfies PluginHost);
}

function handed(result: DeliberationResult = RESULT): BriefContent {
  return {
    title: result.topic,
    headline: `Where the community landed on "${result.topic}"`,
    summary: "",
    sections: [],
    participation_label: null,
    participation_count: result.participant_count,
    comments: [],
    admin_notes: "",
    source_result: result,
  };
}

describe("the grants after the move", () => {
  it("the conversation reaches Polis only; the brief has the AI", () => {
    expect(POLIS_DELIBERATION_MANIFEST.capabilities.adapters).toEqual(["deliberation"]);
    expect(BRIEF_MANIFEST.capabilities.adapters).toContain("ai");
  });
});

describe("the brief's finalize", () => {
  it("writes the summary with the AI, under the conversation summary's purpose, laid out as the conversation's brief", async () => {
    const calls: string[] = [];
    bindHost({ allows: true, calls });
    const content = await finalizeBriefContent(handed());
    expect(calls).toEqual(["job.deliberation_summary"]);
    expect(content.source_result).toBeUndefined();
    expect(content.summary).toBe("Residents want the path kept open.");
    expect(content.sections.map((s) => s.heading)).toEqual([
      "Where the community agreed",
      "Where opinions differed",
      "Questions this raised",
    ]);
    expect(content.participation_label).toBe("12 participant(s) · 4 statement(s)");
    expect(content.participation_count).toBe(12);
    expect(content.deliberation?.summary_text).toBe("Residents want the path kept open.");
    expect(content.deliberation?.linked_polis_data_uri).toBe("https://polis.example/c1");
    expect(content.deliberation?.narrative).toBeUndefined();
  });

  it("on a hub that has not allowed briefs the AI: a brief all the same, with the figures and why there is no text", async () => {
    const calls: string[] = [];
    bindHost({ allows: false, calls });
    const content = await finalizeBriefContent(handed());
    expect(calls).toEqual([]);
    expect(content.summary).toBe("");
    expect(content.deliberation?.narrative).toBe("not_allowed");
    expect(content.deliberation?.participation_stats.total_participants).toBe(12);
    expect(content.sections.map((s) => s.heading)).toEqual(["Where the community agreed", "Where opinions differed"]);
    expect(content.participation_count).toBe(12);
  });

  it("when the model fails or answers without JSON: the figures, marked failed", async () => {
    for (const reply of [new Error("provider down"), "not json at all"]) {
      bindHost({ allows: true, reply });
      const content = await finalizeBriefContent(handed());
      expect(content.deliberation?.narrative).toBe("failed");
      expect(content.summary).toBe("");
      expect(content.participation_count).toBe(12);
    }
  });

  it("from the fake deliberation service: the fake's summary, no model asked", async () => {
    const calls: string[] = [];
    bindHost({ allows: true, calls });
    const summary = await deliberationSummary({ ...RESULT, fake: true });
    expect(calls).toEqual([]);
    expect(summary.summary_text).toBe("What participants said about The river path.");
    expect(summary.methodology.model_used).toBe("none (fake Polis)");
    expect(summary.participation_stats.total_votes).toBe(11);
  });

  it("content with nothing to finish passes through unchanged", async () => {
    const calls: string[] = [];
    bindHost({ allows: true, calls });
    const { source_result: _none, ...vote } = handed();
    const content = await finalizeBriefContent({ ...vote, summary: "The vote passed." });
    expect(content).toEqual({ ...vote, summary: "The vote passed." });
    expect(calls).toEqual([]);
  });
});
