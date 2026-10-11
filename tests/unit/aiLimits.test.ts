// Audit 2, A6: the AI limits' defaults, overrides and the history trim.

import { describe, expect, it } from "vitest";
import { aiLimitDefaults, aiLimitOverridesProblem, effectiveAiLimits, parseAiLimitOverrides } from "../../src/shared/aiLimits.js";
import { recentTurns } from "../../src/modules/civic.assistant/service.js";

describe("AI limits", () => {
  it("gives a demo hub a smaller budget and no web search", () => {
    expect(aiLimitDefaults("demo")).toMatchObject({ daily_tokens: 300_000, web_search: false });
    expect(aiLimitDefaults("live")).toMatchObject({ daily_tokens: 1_500_000, web_search: true, user_per_hour: 20, user_per_day: 60, review_per_hour: 30, hub_per_hour: 200, max_message_chars: 4000, history_messages: 12 });
  });

  it("keeps only valid overrides; a corrupt row means none, never no limits", () => {
    expect(parseAiLimitOverrides('{"user_per_hour": 5, "daily_tokens": -3, "x": 1, "web_search": true}')).toEqual({ user_per_hour: 5, web_search: true });
    expect(parseAiLimitOverrides("not json")).toEqual({});
    expect(parseAiLimitOverrides("[1,2]")).toEqual({});
    expect(effectiveAiLimits("demo", '{"web_search": true}').web_search).toBe(true);
  });

  it("explains a refused override", () => {
    expect(aiLimitOverridesProblem({ user_per_hour: 2.5 })).toMatch(/whole number/);
    expect(aiLimitOverridesProblem({ web_search: "yes" })).toMatch(/on or off/);
    expect(aiLimitOverridesProblem({ nope: 1 })).toMatch(/not an AI limit/);
    expect(aiLimitOverridesProblem({ user_per_hour: null, history_messages: 6 })).toBeNull();
  });
});

describe("recentTurns", () => {
  const h = (n: number) => Array.from({ length: n }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: String(i) }));

  it("keeps everything under the cap", () => {
    expect(recentTurns(h(4), 12)).toHaveLength(4);
    expect(recentTurns(h(30))).toHaveLength(30);
  });

  it("keeps the last messages, starting on the person's turn", () => {
    const out = recentTurns(h(30), 12);
    expect(out).toHaveLength(12);
    expect(out[0]!.role).toBe("user");
    const odd = recentTurns(h(30), 11);
    expect(odd[0]!.role).toBe("user");
    expect(odd).toHaveLength(10);
  });
});
