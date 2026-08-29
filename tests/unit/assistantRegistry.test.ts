// The drafting assistant is registry-driven: a process type opts in by
// declaring getAssistantConfig on its handler, and the generic
// civic.assistant module builds its prompts entirely from that config.
// These tests pin the seam: which types declare configs, that the config
// carries everything the shared route needs, and that the prompt builder
// contains no per-type branches (the config strings ARE the type).

import { describe, it, expect } from "vitest";
import { getProcessHandler, getRegisteredTypes } from "../../src/processes/registry.js";
import { buildSystemPrompt, buildCocCheckPrompt } from "../../src/modules/civic.assistant/systemPrompt.js";
import type {
  AssistantTypeConfig,
  DraftState,
  HubConfig,
} from "../../src/modules/civic.assistant/models.js";

const HUB: HubConfig = {
  hub_name: "Test Hub",
  community_description: "residents of Testville",
};

const EMPTY_DRAFT: DraftState = {
  title: "",
  description: "",
  sources: "",
  considerations: "",
};

function config(type: string): AssistantTypeConfig {
  const c = getProcessHandler(type)?.getAssistantConfig?.();
  if (!c) throw new Error(`expected assistant config for ${type}`);
  return c;
}

const ASSISTANT_TYPES = [
  "civic.proposal",
  "civic.vote",
  "civic.project",
  "civic.polis_deliberation",
];

describe("assistant registry seam", () => {
  it("proposal, vote, project, and conversation declare assistant configs", () => {
    for (const type of ASSISTANT_TYPES) {
      expect(getProcessHandler(type)?.getAssistantConfig?.()).toBeTruthy();
    }
  });

  it("no other registered type declares one (no affordance leaks)", () => {
    const withAssistant = getRegisteredTypes().filter(
      (t) => getProcessHandler(t)?.getAssistantConfig?.(),
    );
    expect(withAssistant.sort()).toEqual([...ASSISTANT_TYPES].sort());
  });

  it("every config is complete enough for the shared route and the UI", () => {
    for (const type of ASSISTANT_TYPES) {
      const c = config(type);
      expect(c.contentNoun.length).toBeGreaterThan(0);
      expect(c.greeting.length).toBeGreaterThan(0);
      expect(c.kickoffMessage.length).toBeGreaterThan(0);
      expect(c.returningGreeting.length).toBeGreaterThan(0);
      expect(c.bestPractices.length).toBeGreaterThan(100);
      expect(c.fields).toContain("title");
      expect(c.fieldGuidance.length).toBeGreaterThan(0);
      for (const g of c.fieldGuidance) {
        expect(c.fields).toContain(g.field);
        expect(g.hint.length).toBeGreaterThan(0);
      }
      expect(typeof c.draftStore.get).toBe("function");
      expect(typeof c.draftStore.appendConversation).toBe("function");
      expect(typeof c.draftStore.saveReviewResult).toBe("function");
      expect(typeof c.draftStore.applyGeneratedDraft).toBe("function");
    }
  });

  it("only the proposal config supports categories", () => {
    expect(config("civic.proposal").supportsCategories).toBe(true);
    expect(config("civic.vote").supportsCategories).toBe(false);
    expect(config("civic.project").supportsCategories).toBe(false);
    expect(config("civic.polis_deliberation").supportsCategories).toBe(false);
  });

  it("the conversation assistant covers topic, framing, sources, and seeds", () => {
    expect(config("civic.polis_deliberation").fields).toEqual([
      "title",
      "description",
      "sources",
      "seed_statements",
    ]);
  });
});

describe("prompt honesty — the assistant never claims form writes", () => {
  it("every prompt carries the never-write rule", () => {
    for (const type of ASSISTANT_TYPES) {
      const prompt = buildSystemPrompt(HUB, undefined, EMPTY_DRAFT, "free_form", config(type));
      expect(prompt).toContain("You never write into the form");
    }
  });

  it("the web-search section only mentions the Sources field when it exists", () => {
    const noSources: AssistantTypeConfig = {
      ...config("civic.vote"),
      fields: ["title", "description"],
    };
    const prompt = buildSystemPrompt(HUB, undefined, EMPTY_DRAFT, "free_form", noSources);
    expect(prompt).toContain("NO sources field");
    expect(prompt).not.toContain('targeting the "sources" field');

    const withSources = buildSystemPrompt(HUB, undefined, EMPTY_DRAFT, "free_form", config("civic.vote"));
    expect(withSources).toContain('targeting the "sources" field');
    expect(withSources).not.toContain("NO sources field");
  });

  it("the output template includes seed_statements only when declared", () => {
    const delib = buildSystemPrompt(HUB, undefined, EMPTY_DRAFT, "free_form", config("civic.polis_deliberation"));
    expect(delib).toContain('"seed_statements": "..."');

    const vote = buildSystemPrompt(HUB, undefined, EMPTY_DRAFT, "free_form", config("civic.vote"));
    expect(vote).not.toContain('"seed_statements"');
  });
});

describe("buildSystemPrompt — config-driven, no per-type branches", () => {
  it("interpolates the declared best-practices doc and title", () => {
    for (const type of ASSISTANT_TYPES) {
      const c = config(type);
      const prompt = buildSystemPrompt(HUB, undefined, EMPTY_DRAFT, "brainstorm", c);
      expect(prompt).toContain(c.bestPracticesTitle);
      expect(prompt).toContain(c.bestPractices.slice(0, 200));
      expect(prompt).toContain(c.brainstormGuidance.slice(0, 100));
      expect(prompt).toContain(c.typeGuidance.slice(0, 80));
    }
  });

  it("the category line follows supportsCategories", () => {
    const proposal = buildSystemPrompt(HUB, "issue", EMPTY_DRAFT, "review", config("civic.proposal"));
    expect(proposal).toContain("Proposal category the user has selected: issue");

    const vote = buildSystemPrompt(HUB, undefined, EMPTY_DRAFT, "review", config("civic.vote"));
    expect(vote).toContain("Process type: vote (no category)");
  });

  it("the considerations step follows the declared field schema", () => {
    const proposal = buildSystemPrompt(HUB, undefined, EMPTY_DRAFT, "brainstorm", config("civic.proposal"));
    expect(proposal).toContain("move on to considerations");

    const vote = buildSystemPrompt(HUB, undefined, EMPTY_DRAFT, "brainstorm", config("civic.vote"));
    expect(vote).toContain("no considerations field");
    expect(vote).not.toContain("move on to considerations");
  });

  it("the output-format JSON lists exactly the declared fields", () => {
    const c = config("civic.vote");
    const prompt = buildSystemPrompt(HUB, undefined, EMPTY_DRAFT, "free_form", c);
    for (const f of c.fields) {
      expect(prompt).toContain(`"${f}": "..."`);
    }
    expect(prompt).not.toContain(`"considerations": "..."`);
  });

  it("always embeds the shared Code of Conduct", () => {
    const prompt = buildSystemPrompt(HUB, undefined, EMPTY_DRAFT, "review", config("civic.project"));
    expect(prompt).toContain("Code of Conduct (defines hard blocks)");
    expect(prompt).toContain("decorum, not opinion");
  });
});

describe("buildCocCheckPrompt — CoC-only, no writing advice", () => {
  it("embeds the CoC and forbids soft suggestions", () => {
    const prompt = buildCocCheckPrompt(HUB);
    expect(prompt).toContain("decorum, not opinion");
    expect(prompt).toContain('severity "hard"');
    expect(prompt).toContain("Do NOT offer writing advice");
  });
});
