import { stripMarkdown } from "../../shared/markdown.js";
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
  DraftState,
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
    buildRespondTool(input.config.fields, { includeDraft: true }),
  ];
  // "any": the model must end on a tool call, so a turn can search first and
  // still finish with a validated reply — never plain text we have to parse.
  const call = { tools, toolChoice: { type: "any" }, responseTool: RESPONSE_TOOL, maxTokens: 4096 };

  // 4096, not 1536: a search turn carries the summary, citations, and a
  // sources card in one JSON object; at 1536 the JSON was being cut off
  // and the person got the prose with no card (2026-09-02).
  const result = await claude({ model, system: systemPrompt, messages, ...call });
  const parsed = toAssistantResponse(result, input.config.fields);

  // Never let "On it — let me take a look" be the end of a turn. If the model
  // narrated an action, ran no tool and produced nothing actionable, nudge it
  // once, inside the same request, to actually do it (Adam, 2026-09-02: "if
  // it's gonna do something it should do it").
  if (deliveredNothing(parsed, result.serverToolUses) && promisesToFollowUp(parsed.message)) {
    console.warn("[assistant] reply promised an action without doing it — nudging once");
    const followUp = await claude({
      model,
      system: systemPrompt,
      messages: [
        ...messages,
        { role: "assistant", content: result.text },
        {
          role: "user",
          content:
            "Go ahead and do that now, in this reply. If it needs a search, run the search and " +
            "put the links in a suggestion card so I can apply them. If you cannot do it, say so " +
            "plainly and tell me what you can do instead — do not tell me you are about to do it.",
        },
      ],
      ...call,
    });
    const nudged = toAssistantResponse(followUp, input.config.fields);
    // The backstop. Two promises in a row is the model failing to act, and
    // shipping the second one would repeat exactly the dead end this guards
    // against — so say the honest thing instead of the hopeful one.
    if (deliveredNothing(nudged, followUp.serverToolUses) && promisesToFollowUp(nudged.message)) {
      console.warn("[assistant] reply promised an action twice — returning the honest fallback");
      return { ...nudged, message: COULD_NOT_ACT };
    }
    return withSomethingToSay(dropRedundantSuggestions(nudged, input.draft_state));
  }

  return withSomethingToSay(dropRedundantSuggestions(parsed, input.draft_state));
}

/** What the person gets when the model twice promised to act and twice
 *  didn't. Honest and still useful, per Adam (2026-09-04): "either say it
 *  can't do it or do it." */
const COULD_NOT_ACT =
  "I wasn't able to do that just now — sorry. Try asking again, or paste anything you've " +
  "already read and we can work from that.";

/** A turn that produced no card, no draft and ran no tool has delivered
 *  nothing, whatever its prose says. Structural, so it holds for every
 *  process type and any wording. */
function deliveredNothing(
  parsed: AssistantResponse,
  serverToolUses: number | undefined,
): boolean {
  return (
    parsed.suggestions.length === 0 &&
    !parsed.draft_proposal &&
    (serverToolUses ?? 0) === 0
  );
}

/** An empty bubble is its own version of saying nothing. */
/**
 * Drop soft suggestions whose revision just restates what a field already
 * holds — the model re-offering a rewrite of a field the person already filled
 * and applied (Adam, 2026-09-05: "it created a new suggestion for the
 * description even though I hadn't changed it"). Compared normalized (trimmed,
 * whitespace-collapsed, case-insensitive) against the current draft value. A
 * HARD block is never dropped — a Code of Conduct problem on existing text
 * must still surface. This is the deterministic backstop; the system prompt
 * also tells the model not to rewrite a filled field unprompted.
 */
function dropRedundantSuggestions(
  response: AssistantResponse,
  draft: DraftState,
): AssistantResponse {
  const norm = (v: string): string =>
    v.trim().replace(/\s+/g, " ").toLowerCase();
  const currentOf = (field: string): string => {
    const raw = (draft as unknown as Record<string, unknown>)[field];
    return typeof raw === "string" ? norm(raw) : "";
  };
  const kept = response.suggestions.filter((sg) => {
    if (sg.severity === "hard") return true;
    if (!sg.field || !sg.suggested_revision) return true;
    const current = currentOf(sg.field);
    if (current.length === 0) return true; // field empty — a real offer
    return norm(sg.suggested_revision) !== current; // drop exact no-ops
  });
  if (kept.length === response.suggestions.length) return response;
  console.warn(
    `[assistant] dropped ${response.suggestions.length - kept.length} no-op suggestion(s) that restated a filled field`,
  );
  return { ...response, suggestions: kept };
}

function withSomethingToSay(response: AssistantResponse): AssistantResponse {
  if (response.message.trim().length > 0) return response;
  return {
    ...response,
    message:
      response.suggestions.length > 0 || response.draft_proposal
        ? "Here's what I put together — take a look at the card below."
        : "Sorry — I didn't manage a reply that time. Ask me again and I'll have another go.",
  };
}

/** A reply that says it is ABOUT to do something rather than doing it:
 *  "On it — let me take a look…", "Searching now — give me a moment."
 *
 *  The 2026-09-02 version required the word "search" (or "look it up") and so
 *  missed "let me take a look at what's been in the news", which is how this
 *  reached prod again (Adam, 2026-09-04). A phrase list will always leak, so
 *  this one is deliberately broad and leans on `deliveredNothing` to keep it
 *  safe: it is only ever consulted for a turn that produced nothing, where a
 *  false positive costs one extra model round and no wrong answer.
 *
 *  Exported for tests. */
export function promisesToFollowUp(message: string): boolean {
  const m = message.trim();
  // A delivered answer — a summary, findings, citations — runs long. A
  // promise is a sentence or two.
  if (m.length === 0 || m.length > 400) return false;
  // "let me know" is an invitation, not a promise; every other "let me" is.
  const future = /\b(i'?ll|i will|i'?m going to|i am going to|let me(?!\s+know)|lemme)\b/i;
  const action =
    /\b(search(ing)?|look(ing)?|check(ing)?|dig(ging)?|find(ing)?|pull(ing)?|gather(ing)?|research(ing)?|scan(ning)?|see what|take a look|have a look)\b/i;
  // Unambiguous on their own — they promise a continuation and nothing else.
  const idiom =
    /\b(on it|hang on|hold on|stand by|one (moment|sec|second)|give me a (moment|sec|second|minute)|be right back|coming right up|in a (moment|sec|second)|working on (it|that))\b/i;
  return (future.test(m) && action.test(m)) || idiom.test(m);
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
  // Formatting is not content: the check reads the stripped text so a
  // marker can neither hide a violation nor be mistaken for one.
  const submission = fields
    .map((f) => ({ label: f.label, text: stripMarkdown(f.text) }))
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
    // Same reliability path as the assistant: a quoted violation with a raw
    // `"` used to break the hand-written JSON and DROP the hard block.
    tools: [buildRespondTool(fields.map((f) => f.label.toLowerCase()), { includeDraft: false })],
    toolChoice: { type: "tool", name: RESPONSE_TOOL },
    responseTool: RESPONSE_TOOL,
  });

  // Everything this prompt returns is a CoC finding — normalize to hard.
  return toAssistantResponse(result, []).suggestions.map((s) => ({
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
      }
    : null;

  return { message, suggestions, draft_proposal };
}

/** Prefer the API-validated tool input; fall back to parsing text only when a
 *  turn produced no tool call (should not happen with tool_choice set). */
function toAssistantResponse(
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
