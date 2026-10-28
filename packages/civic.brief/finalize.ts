// The brief's finalize (plugin session 2; ADR-015): a source hands its brief
// raw material it needs the AI to finish (`source_result`), and the brief
// finishes it here, under its own grant, before the brief is written. The hub
// calls it for a new brief (spawnBriefFromClosedProcess) and a regenerated one
// (src/services/briefRegenerate.ts). Content without a `source_result` passes
// through unchanged: a vote's, a proposal's, a project's.
//
// One kind so far: a conversation's deliberation result. The brief writes the
// summary with the AI (when this hub allows briefs to use it) and lays it out
// as the conversation's brief always was: where the community agreed, where
// opinions differed, the questions it raised.

import type { BriefContent, BriefSection, DeliberationResult, DeliberationSummary } from "@civic-social/plugin-sdk/first-party";
import { briefHost } from "./host.js";
import { fakeDeliberationSummary, summarizeDeliberation, summaryWithoutNarrative, type LlmClient } from "./deliberation/summarize.js";

/** The AI through this package's host: recorded under the conversation summary's purpose, inside the jobs' ceiling. */
function hostLlm(): LlmClient {
  return {
    async complete(params) {
      const ai = briefHost.get().adapter("ai");
      const result = await ai.complete("job.deliberation_summary", {
        model: ai.defaultModel(),
        system: params.system,
        userText: params.user,
        maxTokens: params.maxTokens,
      });
      return result.text;
    },
  };
}

/** A deliberation result's summary: fake, written by the AI, or without a write-up and why. */
export async function deliberationSummary(result: DeliberationResult, llm: LlmClient | null = hostLlm()): Promise<DeliberationSummary> {
  // The hub's admin approved the AI for briefs (a hub that has not updated to
  // a version with it is held to what it approved): asked first, so the fake
  // service's summary, which stands in for the model, follows the same rule.
  if (!llm || !briefHost.get().allows("ai")) return summaryWithoutNarrative(result, "not_allowed");
  if (result.fake) return fakeDeliberationSummary(result);
  try {
    return await summarizeDeliberation(result, llm);
  } catch (err) {
    console.error("[brief] the conversation summary could not be written:", err instanceof Error ? err.message : err);
    return summaryWithoutNarrative(result, "failed");
  }
}

/** A conversation's brief as it has always read, from its summary. */
export function deliberationContent(base: BriefContent, summary: DeliberationSummary): BriefContent {
  const sections: BriefSection[] = [];

  if (summary.top_consensus_statements?.length) {
    sections.push({
      heading: "Where the community agreed",
      body: summary.top_consensus_statements
        .map(
          (s) =>
            `• ${s.statement_text} (${Math.round(s.agree_rate * 100)}% agreed, ${s.vote_count} votes)`,
        )
        .join("\n"),
    });
  }

  if (summary.opinion_groups?.length) {
    sections.push({
      heading: "Where opinions differed",
      body: summary.opinion_groups
        .map((g) => {
          const reps = (g.representative_statements ?? [])
            .map((r) => `   – ${r.text}`)
            .join("\n");
          return `Group of ${g.size} participant(s):\n${reps}`;
        })
        .join("\n\n"),
    });
  }

  if (summary.directed_questions?.length) {
    sections.push({
      heading: "Questions this raised",
      body: summary.directed_questions.map((q) => `• ${q}`).join("\n"),
    });
  }

  const stats = summary.participation_stats;
  const { source_result: _done, ...rest } = base;
  return {
    ...rest,
    summary: summary.summary_text ?? "",
    sections,
    participation_label: stats
      ? `${stats.total_participants} participant(s) · ${stats.total_statements} statement(s)`
      : null,
    participation_count: stats?.total_participants ?? null,
    deliberation: summary,
  };
}

/** Finish what a source handed its brief. Content with nothing to finish is returned as it came. */
export async function finalizeBriefContent(content: BriefContent): Promise<BriefContent> {
  const result = content.source_result;
  if (!result) return content;
  if (result.kind === "deliberation") return deliberationContent(content, await deliberationSummary(result));
  const { source_result: _unknown, ...rest } = content;
  return rest;
}
