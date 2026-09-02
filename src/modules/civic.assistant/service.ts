import {
  callClaudeMultiTurn,
  DEFAULT_MODEL,
  type MultiTurnMessage,
} from "../../utils/anthropic.js";
import { buildSystemPrompt, buildCocCheckPrompt } from "./systemPrompt.js";
import type {
  CallAssistantInput,
  AssistantResponse,
  Suggestion,
  DraftProposal,
  DraftField,
  HubConfig,
} from "./models.js";

export type CallClaudeMultiTurnFn = typeof callClaudeMultiTurn;

/** Hub identity handed to the assistant. Single source — every caller
 *  (draft assistant, CoC-only check) uses this rather than re-declaring. */
export function getHubConfig(): HubConfig {
  return {
    hub_name: process.env.HUB_NAME ?? "Floyd Civic Hub",
    community_description:
      "residents of Floyd County, Virginia — a small rural community in the Blue Ridge Mountains",
  };
}

export async function callAssistant(
  input: CallAssistantInput,
  claude: CallClaudeMultiTurnFn = callClaudeMultiTurn,
): Promise<AssistantResponse> {
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  const systemPrompt = buildSystemPrompt(
    input.hub_config,
    input.category,
    input.draft_state,
    input.phase,
    input.config,
  );

  const messages: MultiTurnMessage[] = [
    ...input.conversation_history,
    { role: "user", content: input.user_message },
  ];

  const tools = [
    {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 3,
    },
  ];

  // 4096, not 1536: a search turn carries the summary, citations, and a
  // sources card in one JSON object; at 1536 the JSON was being cut off
  // and the person got the prose with no card (2026-09-02).
  const result = await claude({ model, system: systemPrompt, messages, tools, maxTokens: 4096 });

  return parseAssistantResponse(result.text, input.config.fields);
}

/**
 * Standalone Code of Conduct check for submission paths that have no
 * drafting assistant (e.g. conversation creation). Returns hard-block
 * suggestions only. Callers are expected to fail open on throw — the
 * real gate is human admin review.
 */
export async function checkTextAgainstCoC(
  fields: Array<{ label: string; text: string }>,
  hubConfig: HubConfig,
  claude: CallClaudeMultiTurnFn = callClaudeMultiTurn,
): Promise<Suggestion[]> {
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const submission = fields
    .filter((f) => f.text.trim().length > 0)
    .map((f) => `${f.label}:\n${f.text}`)
    .join("\n\n");
  if (!submission) return [];

  const result = await claude({
    model,
    system: buildCocCheckPrompt(hubConfig),
    messages: [
      {
        role: "user",
        content: `Check this submission against the Code of Conduct:\n\n${submission}`,
      },
    ],
    maxTokens: 1024,
  });

  // Everything this prompt returns is a CoC finding — normalize to hard.
  return parseAssistantResponse(result.text, []).suggestions.map((s) => ({
    ...s,
    severity: "hard" as const,
  }));
}

function cleanMessage(raw: string): string {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .trim();
}

function extractFallbackMessage(text: string): string {
  const msgMatch = text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (msgMatch) return cleanMessage(msgMatch[1]);
  return text.replace(/```json\s*/g, "").replace(/```\s*/g, "").replace(/\{[\s\S]*\}/, "").trim()
    || "I'm here to help — could you rephrase that?";
}

function parseAssistantResponse(text: string, validFields: DraftField[]): AssistantResponse {
  const stripped = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  const jsonMatch = stripped.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      message: stripped,
      suggestions: [],
      draft_proposal: null,
    };
  }

  const fieldSet = new Set<string>(validFields);
  const isValidField = (v: unknown): v is DraftField =>
    typeof v === "string" && fieldSet.has(v);

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    const message: string = typeof parsed.message === "string"
      ? cleanMessage(parsed.message)
      : extractFallbackMessage(text);

    const suggestions: Suggestion[] = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
          .filter((s: unknown) => s && typeof s === "object")
          .map((s: Record<string, unknown>) => ({
            severity: s.severity === "hard" ? "hard" : "soft",
            quoted_text: typeof s.quoted_text === "string" ? s.quoted_text : null,
            field: isValidField(s.field) ? s.field : null,
            message: typeof s.message === "string" ? s.message : "",
            suggested_revision: typeof s.suggested_revision === "string"
              ? s.suggested_revision
              : null,
          }))
      : [];

    const draft_proposal: DraftProposal | null = parsed.draft_proposal &&
      typeof parsed.draft_proposal === "object"
      ? {
          title: String(parsed.draft_proposal.title ?? ""),
          description: String(parsed.draft_proposal.description ?? ""),
          sources: String(parsed.draft_proposal.sources ?? ""),
          considerations: String(parsed.draft_proposal.considerations ?? ""),
          ...(fieldSet.has("seed_statements")
            ? { seed_statements: String(parsed.draft_proposal.seed_statements ?? "") }
            : {}),
        }
      : null;

    return { message, suggestions, draft_proposal };
  } catch {
    return {
      message: extractFallbackMessage(text),
      suggestions: [],
      draft_proposal: null,
    };
  }
}
