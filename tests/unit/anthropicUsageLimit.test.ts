import { afterEach, describe, expect, it, vi } from "vitest";

// When the AI provider refuses because the account's usage limit is reached
// (2026-10-24: dev's Code of Conduct check stopped until the limit reset),
// the caller still gets the ordinary "try again" ai_unavailable, and the
// operators are told: a reported error, not only a log line.

const reported = vi.hoisted(() => [] as Array<{ code: string; message: string }>);
vi.mock("../../src/utils/reportError.js", () => ({
  reportError: (code: string, message: string) => reported.push({ code, message }),
}));

const { callClaudeMultiTurn, isUsageLimit } = await import("../../src/utils/anthropic.js");

const LIMIT_BODY = {
  type: "error",
  error: {
    type: "invalid_request_error",
    message: "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.",
  },
};

describe("the provider's usage limit", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.ANTHROPIC_API_KEY = originalKey;
    reported.length = 0;
  });

  it("is reported to operators, and the caller gets ai_unavailable", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(LIMIT_BODY), { status: 400 })) as typeof fetch;
    await expect(
      callClaudeMultiTurn({ model: "m", messages: [{ role: "user", content: "hi" }], maxTokens: 10 }),
    ).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(reported.map((r) => r.code)).toEqual(["ai.usage_limit"]);
  });

  it("an ordinary outage is not reported as a usage limit", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response("overloaded", { status: 529 })) as typeof fetch;
    await expect(
      callClaudeMultiTurn({ model: "m", messages: [{ role: "user", content: "hi" }], maxTokens: 10 }),
    ).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(reported).toEqual([]);
  });

  it("recognises the limit and an empty credit balance, nothing else", () => {
    expect(isUsageLimit(new Error(`Anthropic API 400: ${JSON.stringify(LIMIT_BODY)}`))).toBe(true);
    expect(isUsageLimit(new Error("Anthropic API 400: Your credit balance is too low to access the Anthropic API."))).toBe(true);
    expect(isUsageLimit(new Error("Anthropic API 529: overloaded"))).toBe(false);
  });
});
