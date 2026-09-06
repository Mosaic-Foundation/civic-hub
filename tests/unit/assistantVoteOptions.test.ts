// A vote's assistant fields follow its voting method. An approval vote has an
// Options field — a help chip, an applyable "options" card, a slot in the
// prompt and the reply schema — and a yes/no vote has none of that. The
// method → fields map is declared once (VOTE_METHOD_EXTRA_FIELDS) and every
// layer derives from it, so a future method declares its fields and is
// handled everywhere (Adam, 2026-09-05: chips and fields "need to be
// correlated with the fields available based on which voting method is
// chosen… and this should work for all future voting methods").

import { describe, it, expect } from "vitest";
import {
  voteAssistantConfig,
  VOTE_METHOD_EXTRA_FIELDS,
} from "../../src/processes/voteAssistantConfig";
import { buildRespondTool } from "../../src/modules/civic.assistant/service";
import { buildSystemPrompt } from "../../src/modules/civic.assistant/systemPrompt";
import type { DraftState, HubConfig } from "../../src/modules/civic.assistant/models";

const HUB: HubConfig = { hub_name: "Test Hub", community_description: "residents of Testville" };
const base: DraftState = { title: "Which rules?", description: "", sources: "", considerations: "" };

const active = (method: string) =>
  voteAssistantConfig.activeFields!({ ...base, method });

describe("vote assistant fields follow the voting method", () => {
  it("declares options for approval and nothing extra for yes/no, in one map", () => {
    expect(VOTE_METHOD_EXTRA_FIELDS.approval).toEqual(["options"]);
    expect(VOTE_METHOD_EXTRA_FIELDS.yes_no_unsure).toEqual([]);
  });

  it("activeFields includes options only when the method needs a list", () => {
    expect(active("approval")).toContain("options");
    expect(active("yes_no_unsure")).not.toContain("options");
    // An unknown / future method degrades to the shared fields, never crashes.
    expect(active("ranked_choice_not_yet_declared")).toEqual(["title", "description", "sources"]);
  });

  it("the reply schema's field enum follows the active fields", () => {
    const fieldEnum = (fields: readonly string[]) => {
      const tool = buildRespondTool(fields, { includeDraft: true });
      const schema = tool.input_schema as {
        properties: { suggestions: { items: { properties: { field: { enum: unknown[] } } } } };
      };
      return schema.properties.suggestions.items.properties.field.enum;
    };
    expect(fieldEnum(active("approval"))).toContain("options");
    expect(fieldEnum(active("yes_no_unsure"))).not.toContain("options");
  });

  it("the prompt shows Options and the method for an approval vote, and neither field for yes/no", () => {
    const approval = { ...base, method: "approval", options: "" };
    const p1 = buildSystemPrompt(HUB, undefined, approval, "free_form", {
      ...voteAssistantConfig,
      fields: active("approval"),
    });
    expect(p1).toMatch(/Options: \(still empty\)/);
    expect(p1).toMatch(/Voting method: Approval/);

    const yesno = { ...base, method: "yes_no_unsure" };
    const p2 = buildSystemPrompt(HUB, undefined, yesno, "free_form", {
      ...voteAssistantConfig,
      fields: active("yes_no_unsure"),
    });
    expect(p2).not.toMatch(/Options: \(still empty\)/);
    expect(p2).toMatch(/Voting method: Yes \/ No \/ Unsure/);
  });

  it("the type guidance tells the model options are their own field, never the description", () => {
    expect(voteAssistantConfig.typeGuidance).toMatch(/"field": "options"/);
    expect(voteAssistantConfig.typeGuidance).toMatch(/never part of the description/i);
  });
});
