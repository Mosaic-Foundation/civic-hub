import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { chipLabel, joinDocument, splitDocument, type DocumentPart } from "../../src/shared/documentFields.js";
import { applySubstitutions } from "../../src/shared/documentTemplate.js";

const LEGAL = resolve(import.meta.dirname, "../../config/legal");
const templates = readdirSync(LEGAL).filter((f) => f.endsWith(".md"));
const read = (f: string) => readFileSync(resolve(LEGAL, f), "utf-8");
const fields = (parts: DocumentPart[]) => parts.filter((p): p is Extract<DocumentPart, { type: "field" }> => p.type === "field");

describe("a document as fields", () => {
  it.each(templates)("%s comes back byte for byte with no edits, for every kind", (file) => {
    for (const kind of ["place", "organization", "community", "issue"]) {
      for (const byParagraph of [false, true]) {
        const source = read(file);
        expect(joinDocument(splitDocument(source, kind, { byParagraph }), {})).toBe(source);
      }
    }
  });

  it.each(templates)("%s shows no braces and no HTML in any field, and locks nothing", (file) => {
    for (const kind of ["place", "organization"]) {
      const parts = splitDocument(read(file), kind);
      expect(parts.some((p) => p.type === "locked")).toBe(false);
      for (const p of fields(parts)) {
        expect(p.text).not.toMatch(/\{\{|\}\}|<[a-z]/);
        // A heading may name the hub: DocumentEditor fills it in as it does the preview.
        expect(p.label).not.toMatch(/\{\{|#/);
      }
    }
  });

  it("gives a place hub the place wording and another kind the other", () => {
    const source = "## Who\n\n{{#place}}For residents of {PLACE}.{{/place}}{{^place}}For members.{{/place}} Welcome.\n";
    expect(fields(splitDocument(source, "place"))[0]!.text).toBe("For residents of {PLACE}. Welcome.");
    expect(fields(splitDocument(source, "organization"))[0]!.text).toBe("For members. Welcome.");
  });

  it("labels a field by its heading, and what comes before the first as the opening", () => {
    const parts = fields(splitDocument("# Terms\n\n*Version 1*\n\n## Who may join\n\nAnyone.\n\n---\n\n## {HUB_NAME} and you\n\nYes.\n", "place"));
    expect(parts.map((p) => p.label)).toEqual(["Opening", "Who may join", "{HUB_NAME} and you"]);
  });

  it("doesn't count what follows a rule as the section before it", () => {
    const parts = fields(splitDocument("## Contact\n\nWrite.\n\n---\n\n*Applies here.*\n", "place"));
    expect(parts.map((p) => p.label)).toEqual(["Contact", "Closing note"]);
  });

  it("changes only the field edited, and leaves a sibling's logic alone", () => {
    const source = "## One\n\n{{#place}}Place one.{{/place}}{{^place}}Other one.{{/place}}\n\n## Two\n\n{{#place}}Place two.{{/place}}{{^place}}Other two.{{/place}}\n";
    const parts = splitDocument(source, "place");
    const [first] = fields(parts);
    const out = joinDocument(parts, { [first!.id]: "New words." });
    expect(out).toBe("## One\n\nNew words.\n\n## Two\n\n{{#place}}Place two.{{/place}}{{^place}}Other two.{{/place}}\n");
    expect(applySubstitutions(out, { HUB_KIND: "organization" })).toContain("Other two.");
  });

  it("keeps draft notes, unseen, when a field changes", () => {
    const source = "# T\n\n{{#draft}}> **Draft starter content.** See a lawyer {{#place}}in {STATE}{{/place}}{{^place}}in {GOVERNING_STATE}{{/place}}.{{/draft}}\n\n## A\n\nWords.\n";
    const parts = splitDocument(source, "place");
    expect(fields(parts).map((p) => p.text)).toEqual(["Words."]);
    expect(joinDocument(parts, { [fields(parts)[0]!.id]: "Other words." })).toContain("{{#draft}}> **Draft starter content.**");
  });

  it("splits a short fragment by paragraph, naming the contact line", () => {
    const parts = fields(splitDocument(read("who-runs-this.md"), "place", { byParagraph: true }));
    expect(parts.map((p) => p.label)).toEqual(["The opening paragraph", "The contact line"]);
    expect(parts[1]!.text).toContain("{CONTACT_EMAIL}");
  });

  it("locks what it can't hold, and keeps it", () => {
    const source = "## A\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n## B\n\nWords with <b>html</b>.\n\n## C\n\nFine.\n";
    const parts = splitDocument(source, "place");
    expect(parts.filter((p) => p.type === "locked").map((p) => (p as { label: string }).label)).toEqual(["A", "B"]);
    expect(fields(parts).map((p) => p.label)).toEqual(["C"]);
    expect(joinDocument(parts, {})).toBe(source);
  });

  it("offers one empty field for a page with nothing yet", () => {
    const parts = splitDocument("", "place");
    expect(fields(parts)).toHaveLength(1);
    expect(joinDocument(parts, { [fields(parts)[0]!.id]: "Hello." })).toBe("Hello.");
  });

  it("hides a section only for another kind", () => {
    const source = "## Residents\n\n{{#place}}Only for places.{{/place}}\n";
    expect(fields(splitDocument(source, "organization")).map((p) => p.label)).toEqual(["The page"]);
    expect(joinDocument(splitDocument(source, "organization"), {})).toBe(source);
  });

  it("names every placeholder the shared documents use in words", () => {
    for (const file of templates) {
      for (const [, token] of read(file).matchAll(/\{([A-Z_]+)\}/g)) {
        expect(chipLabel(token!), token).toMatch(/^[a-z][a-z -]+$/);
        expect(chipLabel(token!)).not.toContain("_");
      }
    }
  });
});
