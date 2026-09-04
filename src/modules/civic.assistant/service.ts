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
  const parsed = parseAssistantResponse(result.text, input.config.fields);

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
      tools,
      maxTokens: 4096,
    });
    const nudged = parseAssistantResponse(followUp.text, input.config.fields);
    // The backstop. Two promises in a row is the model failing to act, and
    // shipping the second one would repeat exactly the dead end this guards
    // against — so say the honest thing instead of the hopeful one.
    if (deliveredNothing(nudged, followUp.serverToolUses) && promisesToFollowUp(nudged.message)) {
      console.warn("[assistant] reply promised an action twice — returning the honest fallback");
      return { ...nudged, message: COULD_NOT_ACT };
    }
    return withSomethingToSay(nudged);
  }

  return withSomethingToSay(parsed);
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
