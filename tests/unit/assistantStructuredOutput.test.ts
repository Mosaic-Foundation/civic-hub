// The assistant's reply is a tool call whose input the API validates, so the
// model never hand-escapes a long markdown message. Before this, a raw `"`
// inside hand-written JSON broke the parse and dropped every suggestion card
// (Adam, 2026-09-05: "**1. The" and no cards). These tests pin that:
//  - the structured input is used and text is ignored when both exist;
//  - a reply whose TEXT is broken JSON still yields full cards via structured;
//  - the tool schema is built from the type's fields, so it adapts per type;
//  - text-only replies still parse (fallback), which is what the older
//    mocked tests exercise.

import { describe, it, expect, vi } from "vitest";
import {
  callAssistant,
  buildRespondTool,
  RESPONSE_TOOL,
} from "../../src/modules/civic.assistant/service";
import type { CallClaudeMultiTurnFn } from "../../src/modules/civic.assistant/service";
import { proposalAssistantConfig } from "../../src/processes/proposalAssistantConfig";
import { deliberationAssistantConfig } from "../../src/processes/deliberationAssistantConfig";

const baseInput = {
  hub_config: { hub_name: "Test Hub", community_description: "a test community" },
  category: "idea" as const,
  draft_state: {
    title: "Short-term rentals",
    description: "Studies show rents go up by 30% or more.",
    sources: "",
    considerations: "",
  },
  phase: "free_form" as const,
  conversation_history: [],
  user_message: "Anything to make the description better?",
  config: proposalAssistantConfig,
};

// The exact failure: the model quotes the draft with a RAW double-quote in
// its message. As hand-written JSON this is invalid and used to lose the cards.
const brokenText =
  '{"message": "Three suggestions.\\n\\n**1. The "30%" claim is unsourced**", "suggestions": [{"severity":"soft","field":"description","quoted_text":"rents go up by 30% or more","message":"Unsourced","suggested_revision":"rents may rise"}], "draft_proposal": null}';

const structured = {
  message: 'Three suggestions.\n\n**1. The "30%" claim is unsourced**',
  suggestions: [
    {
      severity: "soft",
      field: "description",
      quoted_text: "rents go up by 30% or more",
      message: "Unsourced",
      suggested_revision: "rents may rise",
    },
  ],
  draft_proposal: null,
};

describe("assistant — reply arrives as a validated tool call", () => {
  it("uses the structured input and keeps every card even when the text is broken JSON", async () => {
    const claude = vi.fn().mockResolvedValueOnce({
      text: brokenText,
      structured,
      model: "m",
      serverToolUses: 0,
    });
    const out = await callAssistant(baseInput, claude as unknown as CallClaudeMultiTurnFn);
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].field).toBe("description");
    expect(out.suggestions[0].quoted_text).toBe("rents go up by 30% or more");
    // The message survives intact — quotes and all — not truncated at `"`.
    expect(out.message).toContain('"30%" claim');
  });

  it("proves the old text path would have lost the cards (the regression it fixes)", async () => {
    const claude = vi.fn().mockResolvedValueOnce({ text: brokenText, model: "m", serverToolUses: 0 });
    const out = await callAssistant(baseInput, claude as unknown as CallClaudeMultiTurnFn);
    expect(out.suggestions).toHaveLength(0); // dropped — this is the bug
    expect(out.message).toMatch(/\*\*1\. The$/); // truncated at the quote
  });

  it("asks the API to end the turn on a tool call, naming the reply tool", async () => {
    const claude = vi.fn().mockResolvedValueOnce({ text: "", structured, model: "m", serverToolUses: 0 });
    await callAssistant(baseInput, claude as unknown as CallClaudeMultiTurnFn);
    const args = claude.mock.calls[0][0];
    expect(args.toolChoice).toEqual({ type: "any" });
    expect(args.responseTool).toBe(RESPONSE_TOOL);
    const names = args.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("web_search");
    expect(names).toContain(RESPONSE_TOOL);
  });

  it("still parses a text-only reply, as the fallback", async () => {
    const good = JSON.stringify({ message: "Fine.", suggestions: [], draft_proposal: null });
    const claude = vi.fn().mockResolvedValueOnce({ text: good, model: "m", serverToolUses: 0 });
    const out = await callAssistant(baseInput, claude as unknown as CallClaudeMultiTurnFn);
    expect(out.message).toBe("Fine.");
  });
});

describe("assistant — the reply schema adapts to each type's fields", () => {
  const fieldEnum = (tool: Record<string, unknown>): unknown[] => {
    const schema = tool.input_schema as { properties: { suggestions: { items: { properties: { field: { enum: unknown[] } } } } } };
    return schema.properties.suggestions.items.properties.field.enum;
  };
  const draftKeys = (tool: Record<string, unknown>): string[] => {
    const schema = tool.input_schema as { properties: { draft_proposal: { properties: Record<string, unknown> } } };
    return Object.keys(schema.properties.draft_proposal.properties);
  };

  it("a proposal's field enum is its three fields (plus null)", () => {
    const tool = buildRespondTool(proposalAssistantConfig.fields, { includeDraft: true });
    expect(fieldEnum(tool)).toEqual([...proposalAssistantConfig.fields, null]);
    expect(draftKeys(tool)).toEqual([...proposalAssistantConfig.fields]);
    expect(fieldEnum(tool)).not.toContain("seed_statements");
  });

  it("a conversation's field enum includes seed_statements", () => {
    const tool = buildRespondTool(deliberationAssistantConfig.fields, { includeDraft: true });
    expect(fieldEnum(tool)).toContain("seed_statements");
    expect(draftKeys(tool)).toContain("seed_statements");
  });

  it("a type with an arbitrary field list gets a matching schema — nothing is hardcoded", () => {
    const fields = ["title", "budget_line", "deadline", "sponsor"];
    const tool = buildRespondTool(fields, { includeDraft: true });
    expect(fieldEnum(tool)).toEqual([...fields, null]);
    expect(draftKeys(tool)).toEqual(fields);
  });

  it("the Code of Conduct check gets a suggestions-only schema (no draft_proposal)", () => {
    const tool = buildRespondTool(["title", "description"], { includeDraft: false });
    const schema = tool.input_schema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.properties.draft_proposal).toBeUndefined();
    expect(schema.required).not.toContain("draft_proposal");
  });
});
