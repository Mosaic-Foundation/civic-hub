// A conversation's summary, made by its brief (plugin session 2; ADR-015).
// The conversation hands its brief the result as data (its close pulls it from
// the deliberation service); the brief writes it up with the AI, under its own
// grant. Moved here from the conversation package, which no longer uses the AI.
//
// Without the write-up (the AI failed, or this hub has not allowed briefs to
// use it) the summary still carries the result's own figures: agreement,
// groups and participation, with `narrative` saying why the text is missing.

import type { DeliberationResult, DeliberationSummary } from "../../../src/sdk/index.js";
import { SYSTEM_PROMPT, PROMPT_VERSION, buildUserPrompt } from "./prompt.js";

/** The AI call the brief makes: one prompt in, the model's text out. */
export interface LlmClient {
  complete(params: {
    system: string;
    user: string;
    maxTokens: number;
  }): Promise<string>;
}

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;

/** The figures the result itself gives, before any write-up. */
function fromResult(result: DeliberationResult): Omit<DeliberationSummary, "summary_text" | "directed_questions" | "top_consensus_statements" | "methodology"> {
  return {
    opinion_groups: result.groups.map((g) => ({
      group_id: g.id,
      size: g.size,
      representative_statements: g.representative_statements.map((rs) => ({
        text: rs.text,
        agreement_within_group: rs.repness,
      })),
    })),
    participation_stats: {
      total_participants: result.participant_count,
      total_statements: result.statement_count,
      total_votes: 0,
      opinion_groups_formed: result.groups.length,
    },
    linked_polis_data_uri: result.data_uri,
  };
}

/** The result's broad agreement, as the summary lists it when no model chose. */
function agreement(result: DeliberationResult): DeliberationSummary["top_consensus_statements"] {
  return result.consensus.agree.map((c) => ({
    statement_text: c.text,
    agree_rate: c.agree_rate,
    vote_count: c.vote_count,
  }));
}

/**
 * The fake deliberation service's summary, made without a model (development
 * and tests): what the conversation package's fakeSummarize made before the move.
 */
export function fakeDeliberationSummary(result: DeliberationResult): DeliberationSummary {
  return {
    summary_text: `What participants said about ${result.topic}.`,
    directed_questions: [],
    top_consensus_statements: agreement(result),
    opinion_groups: [],
    participation_stats: {
      total_participants: result.participant_count,
      total_statements: result.statement_count,
      total_votes: result.consensus.agree.reduce((n, c) => n + c.vote_count, 0),
      opinion_groups_formed: 0,
    },
    linked_polis_data_uri: result.data_uri,
    methodology: { prompt_version: "fake", model_used: "none (fake Polis)", generated_at: new Date().toISOString() },
  };
}

/** The summary without a write-up, saying why. */
export function summaryWithoutNarrative(result: DeliberationResult, why: "failed" | "not_allowed"): DeliberationSummary {
  return {
    summary_text: "",
    directed_questions: [],
    top_consensus_statements: agreement(result),
    ...fromResult(result),
    methodology: { prompt_version: PROMPT_VERSION, model_used: "none", generated_at: new Date().toISOString() },
    narrative: why,
  };
}

/** The summary written up by the model. Throws when the model fails or answers without JSON. */
export async function summarizeDeliberation(result: DeliberationResult, llmClient: LlmClient): Promise<DeliberationSummary> {
  const rawText = await llmClient.complete({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(result),
    maxTokens: MAX_TOKENS,
  });

  const parsed = parseLlmOutput(rawText);

  return {
    summary_text: parsed.summary_text,
    directed_questions: parsed.directed_questions,
    top_consensus_statements: parsed.top_consensus_statements.map((cs: any) => ({
      statement_text: cs.statement_text ?? cs.text ?? "",
      agree_rate: cs.agree_rate ?? 0,
      vote_count: cs.vote_count ?? 0,
    })),
    ...fromResult(result),
    methodology: {
      prompt_version: PROMPT_VERSION,
      model_used: MODEL,
      generated_at: new Date().toISOString(),
    },
  };
}

function parseLlmOutput(raw: string): any {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("LLM output did not contain valid JSON");
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("Failed to parse LLM JSON output");
  }
}
