import { describe, it, expect } from "vitest";
import { diffEdit, isSubstantiveEdit, labelForField, substanceOf } from "../../src/services/processEdits.js";
import { getProcessHandler } from "../../src/processes/registry.js";

const current = {
  title: "Skate park",
  description: "Old text",
  content: { sources: ["https://a"], banner_image_url: null, banner_image_alt: null, assistant_helped: false },
  links: [{ to_id: "proc_x", relation: "references" }],
};

describe("diffEdit — only what actually changed, honoring locks", () => {
  it("reports nothing for an identical submit", () => {
    const d = diffEdit(current, { title: "Skate park", description: "Old text", content: { ...current.content }, links: [...current.links] }, []);
    expect(d.changed_fields).toEqual([]);
  });
  it("captures before/after per changed field", () => {
    const d = diffEdit(current, { title: "Skate park", description: "**New** text", content: { sources: ["https://a", "https://b"], banner_image_url: "/x.jpg", banner_image_alt: "x" }, links: [] }, []);
    expect(d.changed_fields).toEqual(["description", "sources", "banner_image_url", "banner_image_alt", "links"]);
    expect(d.previous.description).toBe("Old text");
    expect(d.current.description).toBe("**New** text");
    expect(d.previous.links).toEqual(current.links);
    expect(d.current.links).toEqual([]);
  });
  it("ignores a locked title and the assistant flag", () => {
    const d = diffEdit(current, { title: "Renamed", content: { assistant_helped: true, sources: ["https://a"] } }, ["title"]);
    expect(d.changed_fields).toEqual([]);
  });
  it("treats link order as irrelevant", () => {
    const d = diffEdit({ ...current, links: [{ to_id: "a", relation: "r" }, { to_id: "b", relation: "r" }] }, { links: [{ to_id: "b", relation: "r" }, { to_id: "a", relation: "r" }] }, []);
    expect(d.changed_fields).toEqual([]);
  });
  it("labels fields for people", () => {
    expect(labelForField("banner_image_url")).toBe("banner image");
    expect(labelForField("some_new_key")).toBe("some new key");
  });
});

describe("edit policy is opt-in per type — projects only (Adam, 2026-09-03)", () => {
  it("only civic.project declares editPolicy", () => {
    const editable = ["civic.vote", "civic.proposal", "civic.project", "civic.polis_deliberation", "civic.brief"]
      .filter((t) => typeof getProcessHandler(t)?.editPolicy === "function");
    expect(editable).toEqual(["civic.project"]);
  });
});

describe("formatting-only edits are saved but not recorded (Adam, 2026-09-03)", () => {
  it("bold, list markers, and whitespace changes are not substantive", () => {
    const d = diffEdit(current, { description: "**Old** text" }, []);
    expect(d.changed_fields).toEqual([]);
    expect(d.formatting_only_fields).toEqual(["description"]);
    expect(d.formatting_values.description).toBe("**Old** text");
    expect(substanceOf("What we need:\n- one\n-  two")).toBe(substanceOf("**What we need:**\n\n- one\n- two"));
  });
  it("a changed word, a period, or a capital IS substantive", () => {
    expect(diffEdit(current, { description: "Old text." }, []).changed_fields).toEqual(["description"]);
    expect(diffEdit(current, { description: "old text" }, []).changed_fields).toEqual(["description"]);
    expect(diffEdit(current, { description: "New text" }, []).changed_fields).toEqual(["description"]);
  });
});

describe("isSubstantiveEdit — readers skip pre-rule formatting-only entries", () => {
  it("skips an edit whose only change is formatting", () => {
    expect(isSubstantiveEdit({ changed_fields: ["description"], previous: { description: "What we need:\n- a" }, current: { description: "**What we need:**\n- a" } })).toBe(false);
  });
  it("keeps a wording change and any non-text field", () => {
    expect(isSubstantiveEdit({ changed_fields: ["description"], previous: { description: "Early" }, current: { description: "Underway" } })).toBe(true);
    expect(isSubstantiveEdit({ changed_fields: ["sources"], previous: { sources: [] }, current: { sources: ["https://x"] } })).toBe(true);
  });
});
