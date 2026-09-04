import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../../src/modules/civic.assistant/systemPrompt";
import { proposalAssistantConfig } from "../../src/processes/proposalAssistantConfig";
import { deliberationAssistantConfig } from "../../src/processes/deliberationAssistantConfig";
import { voteAssistantConfig } from "../../src/processes/voteAssistantConfig";
import { projectAssistantConfig } from "../../src/processes/projectAssistantConfig";

const hub = { hub_name: "Test Hub", community_description: "a test community" };

function promptFor(config: Parameters<typeof buildSystemPrompt>[4], draft: Record<string, string>) {
  return buildSystemPrompt(hub, "idea", draft as never, "free_form", config);
}

describe("system prompt — the draft state names every field this form has", () => {
  const configs = [
    ["proposal", proposalAssistantConfig],
    ["conversation", deliberationAssistantConfig],
    ["vote", voteAssistantConfig],
    ["project", projectAssistantConfig],
  ] as const;

  // The bug: empty fields were simply absent from the prompt, so the model
  // had to infer them from a missing line — and took drafts to the end
  // without ever raising Sources (Adam, 2026-09-04).
  it.each(configs)("marks every empty field of a %s as empty", (_name, config) => {
    const prompt = promptFor(config, { title: "A title", description: "A description" });
    for (const field of config.fields) {
      const label = field === "seed_statements" ? "Seed statements" : field[0].toUpperCase() + field.slice(1);
      expect(prompt).toContain(label);
    }
    expect(prompt).toMatch(/Fields still empty:.*Sources/);
  });

  it.each(configs)("says so when a %s draft is complete", (_name, config) => {
    const full = Object.fromEntries(config.fields.map((f) => [f, `content for ${f}`]));
    const prompt = promptFor(config, full);
    expect(prompt).toContain("Every field has content.");
    expect(prompt).not.toContain("(still empty)");
  });

  it("does not name a field the form does not have", () => {
    // Votes have no considerations field; it must not appear as an empty one
    // to offer, or the assistant would push a field nobody can fill.
    const prompt = promptFor(voteAssistantConfig, { title: "T" });
    expect(prompt).not.toContain("Considerations: (still empty)");
    expect(prompt).toContain("Sources: (still empty)");
  });

  it("keeps multi-line values readable", () => {
    const prompt = promptFor(deliberationAssistantConfig, {
      title: "T",
      seed_statements: "One statement\nAnother statement",
    });
    expect(prompt).toContain("Seed statements:\nOne statement\nAnother statement");
  });

  it("tells the assistant to raise each empty field once, without requiring it", () => {
    const prompt = promptFor(proposalAssistantConfig, { title: "T" });
    expect(prompt).toContain("Every field gets asked about once.");
    expect(prompt).toMatch(/leaving it blank is fine/i);
    expect(prompt).toMatch(/never block submission/i);
  });
});
