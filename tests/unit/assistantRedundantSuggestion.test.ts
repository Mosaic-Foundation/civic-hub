// The assistant re-offered a rewrite of a field the creator had already filled
// and applied, and answered a seed-statement offer with a "description" card
// (Adam, 2026-09-05). The deterministic guard here drops a soft suggestion
// whose revision just restates what the field already holds. The seed
// mis-targeting is a prompt rule, covered by the prompt tests; this pins the
// code-side backstop.

import { describe, it, expect, vi } from "vitest";
import { callAssistant } from "../../src/modules/civic.assistant/service";
import type { CallClaudeMultiTurnFn } from "../../src/modules/civic.assistant/service";
import { deliberationAssistantConfig } from "../../src/processes/deliberationAssistantConfig";

const baseInput = {
  hub_config: { hub_name: "Test Hub", community_description: "a test community" },
  category: "issue" as const,
  draft_state: {
    title: "Loose dogs",
    description: "This Hub is for civic participation, not general chat.",
    sources: "",
    considerations: "",
    seed_statements: "",
  },
  phase: "free_form" as const,
  conversation_history: [],
  user_message: "That sounds good. I think I'm done.",
  config: deliberationAssistantConfig,
};

function reply(suggestions: unknown[]): string {
  return JSON.stringify({ message: "Before you go…", suggestions, draft_proposal: null });
}

describe("assistant — a filled field is not re-suggested", () => {
  it("drops a soft revision that only restates the current field value", async () => {
    // Same text as draft_state.description, just re-cased and re-spaced.
    const noOp = reply([
      {
        severity: "soft",
        quoted_text: null,
        field: "description",
        message: "Reframed the description",
        suggested_revision: "This Hub is for civic participation,   not general chat.",
      },
    ]);
    const claude = vi.fn().mockResolvedValueOnce({ text: noOp, model: "m", serverToolUses: 0 });
    const out = await callAssistant(baseInput, claude as unknown as CallClaudeMultiTurnFn);
    expect(out.suggestions).toHaveLength(0);
  });

  it("keeps a genuine offer for an EMPTY field (seed statements)", async () => {
    const seeds = reply([
      {
        severity: "soft",
        quoted_text: null,
        field: "seed_statements",
        message: "A balanced starter set",
        suggested_revision: "Leashing dogs is basic courtesy.\nRural dogs need room to roam.",
      },
    ]);
    const claude = vi.fn().mockResolvedValueOnce({ text: seeds, model: "m", serverToolUses: 0 });
    const out = await callAssistant(baseInput, claude as unknown as CallClaudeMultiTurnFn);
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].field).toBe("seed_statements");
  });

  it("keeps a real edit of a filled field (different text)", async () => {
    const realEdit = reply([
      {
        severity: "soft",
        quoted_text: null,
        field: "description",
        message: "Sharper opening",
        suggested_revision: "Floyd is changing fast, and this Hub is where we talk it through.",
      },
    ]);
    const claude = vi.fn().mockResolvedValueOnce({ text: realEdit, model: "m", serverToolUses: 0 });
    const out = await callAssistant(baseInput, claude as unknown as CallClaudeMultiTurnFn);
    expect(out.suggestions).toHaveLength(1);
  });

  it("never drops a hard block, even one restating a filled field", async () => {
    const hard = reply([
      {
        severity: "hard",
        quoted_text: "This Hub is for civic participation, not general chat.",
        field: "description",
        message: "Contains a Code of Conduct problem",
        suggested_revision: "This Hub is for civic participation, not general chat.",
      },
    ]);
    const claude = vi.fn().mockResolvedValueOnce({ text: hard, model: "m", serverToolUses: 0 });
    const out = await callAssistant(baseInput, claude as unknown as CallClaudeMultiTurnFn);
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].severity).toBe("hard");
  });
});

describe("assistant prompt — the rules that steer the model", () => {
  it("tells the model a filled field is done and binds a seed offer to its field", async () => {
    // Pull the system prompt the service builds and assert the new rules are in it.
    let captured = "";
    const claude = vi.fn().mockImplementation(async (args: { system: string }) => {
      captured = args.system;
      return { text: reply([]), model: "m", serverToolUses: 0 };
    });
    await callAssistant(baseInput, claude as unknown as CallClaudeMultiTurnFn);
    expect(captured).toMatch(/filled field is done|do NOT offer an unprompted rewrite/i);
    expect(captured).toMatch(/seed statements[^]*?"seed_statements"/i);
  });
});
