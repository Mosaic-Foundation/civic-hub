import { afterEach, describe, expect, it, vi } from "vitest";
import { callClaudeMultiTurn } from "../../src/utils/anthropic";

// The web_search server tool can pause the turn mid-reply. The client must
// continue the turn (send the partial content back) instead of returning the
// pre-search text as the whole answer.

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("callClaudeMultiTurn — server-tool pause_turn", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("continues a paused turn and returns the text from the final reply", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const calls: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push(body);
      if (calls.length === 1) {
        return jsonResponse({
          model: "m",
          stop_reason: "pause_turn",
          content: [
            { type: "text", text: "On it — searching now." },
            { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "bridging" } },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        });
      }
      return jsonResponse({
        model: "m",
        stop_reason: "end_turn",
        content: [
          { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [] },
          { type: "text", text: '{"message":"Found three sources.","suggestions":[{"field":"sources","suggested_revision":"A: https://a.example"}],"draft_proposal":null}' },
        ],
        usage: { input_tokens: 20, output_tokens: 40 },
      });
    }) as typeof fetch;

    const result = await callClaudeMultiTurn({
      model: "m",
      messages: [{ role: "user", content: "Please search." }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });

    expect(calls).toHaveLength(2);
    // The continuation carries the paused content back as the assistant turn.
    const second = calls[1].messages as Array<{ role: string }>;
    expect(second[second.length - 1].role).toBe("assistant");
    expect(result.text).toContain('"message":"Found three sources."');
    expect(result.text).not.toMatch(/^On it/);
    expect(result.usage).toEqual({ input_tokens: 30, output_tokens: 45 });
  });

  it("still returns a plain end_turn reply in one call", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ model: "m", stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] }),
    ) as typeof fetch;
    const result = await callClaudeMultiTurn({ model: "m", messages: [{ role: "user", content: "x" }] });
    expect(result.text).toBe("hi");
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });
});
