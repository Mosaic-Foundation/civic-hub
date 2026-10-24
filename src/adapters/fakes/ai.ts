// The `ai` adapter's fake (ADR-012): answers without a model or a network.
// What CI, Playwright and run-anywhere use (CIVIC_FAKE_ADAPTERS=on).
//
//   any text containing [ai-down]        → the provider is unavailable (503)
//   any text containing [ai-usage-limit] → the account's limit is used up
//                                          (marked, so the gate reports it)
//   a conversation with a responseTool   → that tool's input: a short message,
//                                          no suggestions
//   anything else                        → a short fixed text
// Every call is kept in `calls` for tests. The Code of Conduct check's fake
// rule is separate (src/debug/fakeCodeOfConduct.ts, chosen in
// checkTextAgainstCoC), because the suites assert its findings' fields.

import { UnavailableError } from "../../errors/index.js";
import type { AiCallContext, AiConversationInput, AiProvider, AiResult, AiSingleTurnInput, UsageLimitMarked } from "../ai.js";

export const FAKE_AI_DOWN = "[ai-down]";
export const FAKE_AI_USAGE_LIMIT = "[ai-usage-limit]";
export const FAKE_AI_MODEL = "fake-model";
export const FAKE_AI_REPLY = "This is the test assistant's reply.";

export interface FakeAi extends AiProvider {
  calls: Array<{ purpose: string; kind: "complete" | "converse"; text: string }>;
}

function failIfAsked(text: string): void {
  if (text.includes(FAKE_AI_DOWN)) {
    throw new UnavailableError("The AI service isn't responding right now. Please try again in a moment.", "ai_unavailable");
  }
  if (text.includes(FAKE_AI_USAGE_LIMIT)) {
    const cause = Object.assign(new Error("fake AI: You have reached your specified API usage limits."), { aiUsageLimit: true as const });
    throw Object.assign(
      new UnavailableError("The AI service isn't responding right now. Please try again in a moment.", "ai_unavailable", { cause }),
      {} as UsageLimitMarked,
    );
  }
}

const USAGE = { input_tokens: 10, output_tokens: 5 };

export function fakeAi(opts: { configured?: boolean } = {}): FakeAi {
  const calls: FakeAi["calls"] = [];
  return {
    name: "fake",
    calls,
    configured: () => opts.configured ?? true,
    defaultModel: () => FAKE_AI_MODEL,
    async complete(input: AiSingleTurnInput, ctx: AiCallContext): Promise<AiResult> {
      const text = `${input.system ?? ""}\n${input.userText}`;
      calls.push({ purpose: ctx.purpose, kind: "complete", text });
      failIfAsked(text);
      return { text: "Test summary.", model: input.model, usage: USAGE };
    },
    async converse(input: AiConversationInput, ctx: AiCallContext): Promise<AiResult> {
      const text = `${input.system ?? ""}\n${input.messages.map((m) => m.content).join("\n")}`;
      calls.push({ purpose: ctx.purpose, kind: "converse", text });
      failIfAsked(input.messages.map((m) => m.content).join("\n"));
      if (input.responseTool) {
        return {
          text: "",
          structured: { message: FAKE_AI_REPLY, suggestions: [] },
          model: input.model,
          usage: USAGE,
          serverToolUses: 0,
        };
      }
      return { text: FAKE_AI_REPLY, model: input.model, usage: USAGE, serverToolUses: 0 };
    },
  };
}
