import type { PolisAdapter } from "../adapter/types.js";
import type { DeliberationSummary } from "../types.js";
import {
  SYSTEM_PROMPT,
  PROMPT_VERSION,
  buildUserPrompt,
} from "./promptBuilder.js";

export interface LlmClient {
  complete(params: {
    system: string;
    user: string;
    maxTokens: number;
  }): Promise<string>;
}

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;

export interface PolisSummarizerConfig {
  llmClient: LlmClient;
  /** Polis's address, or how to read it for the hub in scope. */
  polisBaseUrl: string | (() => string);
}

export function createPolisSummarizer(config: PolisSummarizerConfig) {
  const { llmClient } = config;
  const polisBaseUrl = (): string =>
    typeof config.polisBaseUrl === "function" ? config.polisBaseUrl() : config.polisBaseUrl;

  return async function summarize(
    conversationId: string,
    adapter: PolisAdapter,
    topic: string,
  ): Promise<DeliberationSummary> {
    const [clusterState, statements] = await Promise.all([
      adapter.pullClusterState(conversationId),
      adapter.getStatements(conversationId),
    ]);

    const userPrompt = buildUserPrompt(clusterState, statements, topic);

    const rawText = await llmClient.complete({
      system: SYSTEM_PROMPT,
      user: userPrompt,
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
      opinion_groups: clusterState.groups.map((g) => ({
        group_id: g.id,
        size: g.size,
        representative_statements: g.representative_statements.map((rs) => ({
          text: rs.text,
          agreement_within_group: rs.repness,
        })),
      })),
      participation_stats: {
        total_participants: clusterState.participant_count,
        total_statements: clusterState.statement_count,
        total_votes: 0,
        opinion_groups_formed: clusterState.groups.length,
      },
      linked_polis_data_uri: `${polisBaseUrl()}/${conversationId}`,
      methodology: {
        prompt_version: PROMPT_VERSION,
        model_used: MODEL,
        generated_at: new Date().toISOString(),
      },
    };
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
