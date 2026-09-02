import { describe, it, expect, vi } from "vitest";
import { callAssistant, claimsToBeSearching } from "../../src/modules/civic.assistant/service";
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

describe("assistant — a promised search is never the end of a turn", () => {
  it("nudges once when the model narrates a search without running it", async () => {
    const claude = vi.fn()
      .mockResolvedValueOnce({ text: narration, model: "m", serverToolUses: 0 })
      .mockResolvedValueOnce({ text: results, model: "m", serverToolUses: 1 });
    const out = await callAssistant(baseInput, claude as unknown as CallClaudeMultiTurnFn);
    expect(claude).toHaveBeenCalledTimes(2);
    const second = claude.mock.calls[1][0];
    expect(second.messages.at(-1).role).toBe("user");
    expect(second.messages.at(-1).content).toMatch(/run the search now/i);
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].field).toBe("sources");
    expect(out.message).toMatch(/Apply/);
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

  it("recognizes the promise-to-search phrasings", () => {
    expect(claimsToBeSearching("On it — searching now.")).toBe(true);
    expect(claimsToBeSearching("Searching now — give me a moment.")).toBe(true);
    expect(claimsToBeSearching("Let me look that up.")).toBe(true);
    expect(claimsToBeSearching("Here are three sources I found on tool libraries in small towns.")).toBe(false);
    expect(claimsToBeSearching("I can search for sources whenever you like.")).toBe(false);
  });
});
