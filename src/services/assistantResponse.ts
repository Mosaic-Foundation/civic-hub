// The assistant's reply as a tool call, and reading it back (kernel step 3):
// the Code of Conduct check (src/services/codeOfConductAi.ts) and the drafting
// assistant feature (features/assistant/) both ask the model through the
// `respond` tool and read its answer here.

import type { AiResult } from "../adapters/ai.js";
import type { AssistantResponse, DraftField, DraftProposal, Suggestion } from "../models/assistant.js";

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

/**
 * The assistant's reply as a TOOL, so the API validates the shape and the
 * model never hand-escapes a long markdown message. Built from the type's
 * declared fields — a proposal's `field` enum is title/description/sources,
 * a conversation's adds seed_statements, and a type registered tomorrow with
 * two fields or seven gets a matching schema by declaring them. This is what
 * fixed the "**1. The" truncation Adam hit on 2026-09-05: a raw `"` inside a
 * hand-written JSON string broke the parse and dropped every card.
 */
export const RESPONSE_TOOL = "respond";

export function buildRespondTool(
  fields: readonly string[],
  opts: { includeDraft: boolean },
): Record<string, unknown> {
  const fieldEnum = [...fields, null];
  const suggestion = {
    type: "object",
    properties: {
      severity: { type: "string", enum: ["soft", "hard"] },
      quoted_text: {
        type: ["string", "null"],
        description:
          "For a targeted edit: the EXACT existing text to replace, copied verbatim from the draft. Null for a whole-field suggestion.",
      },
      field: { type: ["string", "null"], enum: fieldEnum },
      message: { type: "string", description: "The suggestion, in plain prose." },
      suggested_revision: {
        type: ["string", "null"],
        description:
          "The replacement text. Required for every suggestion so the person can Apply it. For a whole-field suggestion this is the COMPLETE new value of the field.",
      },
    },
    required: ["severity", "quoted_text", "field", "message", "suggested_revision"],
    additionalProperties: false,
  };
  const draftProps: Record<string, unknown> = {};
  for (const f of fields) draftProps[f] = { type: "string" };
  const properties: Record<string, unknown> = {
    message: {
      type: "string",
      description:
        "Your conversational reply to the person. Brief — content for form fields goes in suggestions, not here.",
    },
    suggestions: { type: "array", items: suggestion },
  };
  const required = ["message", "suggestions"];
  if (opts.includeDraft) {
    properties.draft_proposal = {
      type: ["object", "null"],
      description:
        "Only when generating a first draft in the brainstorm phase after the person says yes; otherwise null.",
      properties: draftProps,
      additionalProperties: false,
    };
    required.push("draft_proposal");
  }
  return {
    name: RESPONSE_TOOL,
    description:
      "Deliver your reply to the person. Call this exactly once to end every turn — it is the only way your message and suggestion cards reach them.",
    input_schema: { type: "object", properties, required, additionalProperties: false },
  };
}

/** Map a reply object — from the tool call, or from parsed text — onto the
 *  AssistantResponse contract, validating fields against the type. */
function normalizeAssistantPayload(
  parsed: Record<string, unknown>,
  validFields: DraftField[],
  rawText: string,
): AssistantResponse {
  const fieldSet = new Set<string>(validFields);
  const isValidField = (v: unknown): v is DraftField =>
    typeof v === "string" && fieldSet.has(v);

  const message: string = typeof parsed.message === "string"
    ? cleanMessage(parsed.message)
    : extractFallbackMessage(rawText);

  const suggestions: Suggestion[] = Array.isArray(parsed.suggestions)
    ? (parsed.suggestions as unknown[])
        .filter((s: unknown) => s && typeof s === "object")
        .map((s) => {
          const o = s as Record<string, unknown>;
          return {
            severity: o.severity === "hard" ? "hard" : "soft",
            quoted_text: typeof o.quoted_text === "string" ? o.quoted_text : null,
            field: isValidField(o.field) ? o.field : null,
            message: typeof o.message === "string" ? o.message : "",
            suggested_revision: typeof o.suggested_revision === "string"
              ? o.suggested_revision
              : null,
          };
        })
    : [];

  const dp = parsed.draft_proposal as Record<string, unknown> | null | undefined;
  const draft_proposal: DraftProposal | null = dp && typeof dp === "object"
    ? {
        title: String(dp.title ?? ""),
        description: String(dp.description ?? ""),
        sources: String(dp.sources ?? ""),
        considerations: String(dp.considerations ?? ""),
        ...(fieldSet.has("seed_statements")
          ? { seed_statements: String(dp.seed_statements ?? "") }
          : {}),
        ...(fieldSet.has("options") ? { options: String(dp.options ?? "") } : {}),
      }
    : null;

  return { message, suggestions, draft_proposal };
}

/** Prefer the API-validated tool input; fall back to parsing text only when a
 *  turn produced no tool call (should not happen with tool_choice set). */
export function toAssistantResponse(
  result: { text: string; structured?: unknown },
  validFields: DraftField[],
): AssistantResponse {
  if (result.structured && typeof result.structured === "object") {
    return normalizeAssistantPayload(
      result.structured as Record<string, unknown>,
      validFields,
      result.text,
    );
  }
  return parseAssistantResponse(result.text, validFields);
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
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    return normalizeAssistantPayload(parsed, validFields, text);
  } catch {
    return {
      message: extractFallbackMessage(text),
      suggestions: [],
      draft_proposal: null,
    };
  }
}
