import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { applySubstitutions } from "../../src/services/hubDocuments.js";

// The documents are shared by every hub, with the place-specific names
// substituted. The thing that has to stay true is that Floyd's rendering is
// byte-identical to the text production serves today: templating is a
// refactor of how the words are stored, and must not change a word of them.
//
// If this fails, either a template was edited or Floyd's values changed. Both
// are real events; neither should happen by accident.

const FLOYD = {
  HUB_NAME: "Floyd Civic Hub",
  PLACE: "Floyd County",
  JURISDICTION: "Floyd County, Virginia",
  STATE: "Virginia",
  GOVERNING_BODY: "Board of Supervisors",
};

const root = resolve(import.meta.dirname, "../..");
// The three documents Floyd takes from the SHARED set. Substituting Floyd's
// values into each must reproduce the text production serves today.
//
// The proposal guide is deliberately absent: its worked examples named a
// farmers market and a town park, which no substitution can make sensible on
// another hub. The shared version was rewritten to be placeless and Floyd
// keeps its own as an override — covered separately below.
const PAIRS: Array<[string, string]> = [
  ["config/legal/terms.md", "ui/src/content/legal/terms.md"],
  ["config/legal/privacy.md", "ui/src/content/legal/privacy.md"],
  ["config/legal/code-of-conduct.md", "ui/src/content/legal/code-of-conduct.md"],
];

function sha(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

describe("shared legal documents", () => {
  it.each(PAIRS)(
    "%s renders byte-identical to what Floyd serves today",
    (templatePath, originalPath) => {
      const template = readFileSync(resolve(root, templatePath), "utf-8");
      const original = readFileSync(resolve(root, originalPath), "utf-8");
      expect(sha(applySubstitutions(template, FLOYD))).toBe(sha(original));
    },
  );

  it("leaves a placeholder alone when the hub has no value for it", () => {
    // The documents are draft starter content. A hub that has not named its
    // governing body should show the placeholder in review, not a sentence
    // with a hole where a name belongs.
    expect(applySubstitutions("the {GOVERNING_BODY} meets", {})).toBe(
      "the {GOVERNING_BODY} meets",
    );
  });

  it("substitutes every occurrence, not just the first", () => {
    expect(applySubstitutions("{PLACE} and {PLACE}", { PLACE: "Athens" })).toBe(
      "Athens and Athens",
    );
  });

  it("does not touch text that merely looks like a placeholder", () => {
    // `{LIKE_THIS}` appears in the draft warning as an illustration.
    expect(applySubstitutions("marked `{LIKE_THIS}` should be", FLOYD)).toBe(
      "marked `{LIKE_THIS}` should be",
    );
  });
});

describe("the proposal guide is generic, and Floyd keeps its own", () => {
  const shared = readFileSync(
    resolve(root, "config/legal/proposal-best-practices.md"),
    "utf-8",
  );
  const floyd = readFileSync(
    resolve(root, "config/hubs/floyd/proposal-best-practices.md"),
    "utf-8",
  );

  it("names no place in the shared version", () => {
    // Not just "Floyd" as a word: the failure this guards against is a hub in
    // another state being handed advice about somewhere it has never heard of.
    expect(shared).not.toMatch(/Floyd/);
  });

  it("uses only placeholders a hub can fill", () => {
    const names = [...shared.matchAll(/\{([A-Z_]+)\}/g)].map((m) => m[1]);
    for (const name of names) {
      expect(
        ["HUB_NAME", "PLACE", "JURISDICTION", "STATE", "GOVERNING_BODY"],
      ).toContain(name);
    }
  });

  it("reads cleanly for a hub that is not Floyd", () => {
    const athens = applySubstitutions(shared, {
      HUB_NAME: "Athens Civic Hub",
      PLACE: "Athens",
      JURISDICTION: "Athens, Virginia",
      STATE: "Virginia",
      GOVERNING_BODY: "Town Council",
    });
    expect(athens).not.toMatch(/\{[A-Z_]+\}/);
    expect(athens).not.toMatch(/Floyd/);
  });

  it("keeps Floyd's own version, examples and all", () => {
    // This is the text Floyd has been serving. It becomes Floyd's override
    // row rather than being edited into something blander.
    expect(floyd).toMatch(/Floyd/);
    expect(floyd).not.toBe(shared);
  });
});
