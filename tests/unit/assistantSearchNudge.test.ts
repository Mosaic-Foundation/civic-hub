import { describe, it, expect, vi } from "vitest";
import { callAssistant, promisesToFollowUp } from "../../src/modules/civic.assistant/service";
import type { CallClaudeMultiTurnFn } from "../../src/modules/civic.assistant/service";
import { proposalAssistantConfig } from "../../src/processes/proposalAssistantConfig";

const baseInput = {
  hub_config: { hub_name: "Test Hub", community_description: "a test community" },
  category: "idea" as const,
  draft_state: { title: "Tool library", description: "Borrow instead of buy.", sources: "", considerations: "" },
  phase: "free_form" as const,
  conversation_history: [],
  user_message: "Please search for sources on tool libraries.",
  config: proposalAssistantConfig,
};

const narration = JSON.stringify({ message: "On it — searching now.", suggestions: [], draft_proposal: null });
const results = JSON.stringify({
  message: "Found two. They're in a suggestion card below — click Apply to add them to Sources.",
  suggestions: [{ severity: "soft", quoted_text: null, field: "sources", message: "Two sources", suggested_revision: "Tool library guide: https://a.example\nCase study: https://b.example" }],
  draft_proposal: null,
});

describe("assistant — a promised action is never the end of a turn", () => {
  it("nudges once when the model narrates a search without running it", async () => {
    const claude = vi.fn()
      .mockResolvedValueOnce({ text: narration, model: "m", serverToolUses: 0 })
      .mockResolvedValueOnce({ text: results, model: "m", serverToolUses: 1 });
    const out = await callAssistant(baseInput, claude as unknown as CallClaudeMultiTurnFn);
    expect(claude).toHaveBeenCalledTimes(2);
    const second = claude.mock.calls[1][0];
    expect(second.messages.at(-1).role).toBe("user");
    expect(second.messages.at(-1).content).toMatch(/do that now, in this reply/i);
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].field).toBe("sources");
    expect(out.message).toMatch(/Apply/);
  });

  // The exact reply that reached prod on 2026-09-04: no "search" anywhere in
  // it, which is how the first version of this guard let it through.
  it("nudges on a promise that never uses the word 'search'", async () => {
    const takeALook = JSON.stringify({
      message: "On it — let me take a look at what's been in the news lately for Floyd County.",
      suggestions: [],
      draft_proposal: null,
    });
    const claude = vi.fn()
      .mockResolvedValueOnce({ text: takeALook, model: "m", serverToolUses: 0 })
      .mockResolvedValueOnce({ text: results, model: "m", serverToolUses: 1 });
    const out = await callAssistant(baseInput, claude as unknown as CallClaudeMultiTurnFn);
    expect(claude).toHaveBeenCalledTimes(2);
    expect(out.suggestions).toHaveLength(1);
  });

  it("does not nudge when the search actually ran", async () => {
    const claude = vi.fn().mockResolvedValueOnce({ text: results, model: "m", serverToolUses: 1 });
    const out = await callAssistant(baseInput, claude as unknown as CallClaudeMultiTurnFn);
    expect(claude).toHaveBeenCalledTimes(1);
    expect(out.suggestions).toHaveLength(1);
  });

  it("does not nudge an ordinary reply that merely mentions searching", async () => {
    const plain = JSON.stringify({ message: "I can search for sources whenever you like — just say the word.", suggestions: [], draft_proposal: null });
    const claude = vi.fn().mockResolvedValueOnce({ text: plain, model: "m", serverToolUses: 0 });
    await callAssistant(baseInput, claude as unknown as CallClaudeMultiTurnFn);
    expect(claude).toHaveBeenCalledTimes(1);
  });

  it("does not nudge a question that ends with 'let me know'", async () => {
    const asking = JSON.stringify({ message: "Which angle matters most to you here? Let me know and we'll start there.", suggestions: [], draft_proposal: null });
    const claude = vi.fn().mockResolvedValueOnce({ text: asking, model: "m", serverToolUses: 0 });
    await callAssistant(baseInput, claude as unknown as CallClaudeMultiTurnFn);
    expect(claude).toHaveBeenCalledTimes(1);
  });

  it("never ships a second promise — says plainly that it could not act", async () => {
    const again = JSON.stringify({ message: "Give me a moment and I'll pull those together.", suggestions: [], draft_proposal: null });
    const claude = vi.fn()
      .mockResolvedValueOnce({ text: narration, model: "m", serverToolUses: 0 })
      .mockResolvedValueOnce({ text: again, model: "m", serverToolUses: 0 });
    const out = await callAssistant(baseInput, claude as unknown as CallClaudeMultiTurnFn);
    expect(claude).toHaveBeenCalledTimes(2);
    expect(promisesToFollowUp(out.message)).toBe(false);
    expect(out.message).toMatch(/wasn't able to do that/i);
  });

  it("never returns an empty bubble", async () => {
    const blank = JSON.stringify({ message: "   ", suggestions: [], draft_proposal: null });
    const claude = vi.fn().mockResolvedValueOnce({ text: blank, model: "m", serverToolUses: 0 });
    const out = await callAssistant(baseInput, claude as unknown as CallClaudeMultiTurnFn);
    expect(out.message.trim().length).toBeGreaterThan(0);
  });

  it("recognizes a promise however it is phrased", () => {
    expect(promisesToFollowUp("On it — searching now.")).toBe(true);
    expect(promisesToFollowUp("Searching now — give me a moment.")).toBe(true);
    expect(promisesToFollowUp("Let me look that up.")).toBe(true);
    expect(promisesToFollowUp("On it — let me take a look at what's been in the news lately for Floyd County.")).toBe(true);
    expect(promisesToFollowUp("I'll dig through recent coverage and report back.")).toBe(true);
    expect(promisesToFollowUp("Hang on, checking that.")).toBe(true);
    expect(promisesToFollowUp("Here are three sources I found on tool libraries in small towns.")).toBe(false);
    expect(promisesToFollowUp("I can search for sources whenever you like.")).toBe(false);
    expect(promisesToFollowUp("Let me know which of these you'd like to keep.")).toBe(false);
    expect(promisesToFollowUp("")).toBe(false);
  });
});
