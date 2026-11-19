// The drafting assistant's conversation (features/assistant; kernel step 3, out
// of civic.assistant): a chat about one draft, with suggestion cards the person
// applies, shaped by the type's own config (ProcessHandler.getAssistantConfig).
// The Code of Conduct check is the kernel's (src/services/codeOfConductAi.ts).

import {
  aiConverse,
  aiDefaultModel,
  buildRespondTool,
  RESPONSE_TOOL,
  toAssistantResponse,
  type AiMessage,
  type AssistantResponse,
  type CallAssistantInput,
  type CallClaudeMultiTurnFn,
  type DraftField,
  type DraftProposal,
  type DraftState,
  type Suggestion,
} from "../../src/sdk/index.js";
import { stripMarkdown } from "../../src/shared/markdown.js";
import { buildSystemPrompt } from "./systemPrompt.js";

export async function callAssistant(
  input: CallAssistantInput,
  claudeFn?: CallClaudeMultiTurnFn,
): Promise<AssistantResponse> {
  const purpose = input.purpose ?? "assistant.message";
  const claude: CallClaudeMultiTurnFn = claudeFn ?? ((i) => aiConverse(purpose, i));
  const model = aiDefaultModel();

  // Web search is off on a demo hub by default, and wherever the operator
  // turned it off (Audit 2). The prompt's search guidance is then overridden
  // in so many words, so the model does not offer what it cannot do.
  const webSearch = input.limits?.web_search ?? true;
  const systemPrompt =
    buildSystemPrompt(input.hub_config, input.category, input.draft_state, input.phase, input.config) +
    (webSearch ? "" : NO_WEB_SEARCH);

  const messages: AiMessage[] = [
    ...recentTurns(input.conversation_history, input.limits?.history_messages),
    { role: "user", content: input.user_message },
  ];

  const tools = [
    ...(webSearch ? [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] : []),
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

/** Appended to the system prompt where web search is off. */
const NO_WEB_SEARCH = `

## Web search is not available here
This hub has no web search. You do not have a search tool, whatever the guidance above says. Do not offer to search or say you will look something up. If a source would help, tell the person what kind of source to look for and suggest they paste what they find.`;

/**
 * The last `max` messages of the conversation, starting on a person's turn
 * (the API wants the first message to be the user's). Undefined keeps all.
 */
export function recentTurns<T extends { role: "user" | "assistant" }>(history: readonly T[], max?: number): T[] {
  if (max === undefined || history.length <= max) return [...history];
  const tail = history.slice(history.length - max);
  const firstUser = tail.findIndex((m) => m.role === "user");
  return firstUser < 0 ? [] : tail.slice(firstUser);
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

