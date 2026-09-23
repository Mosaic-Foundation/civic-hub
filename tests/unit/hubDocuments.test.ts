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
const PAIRS: Array<[string, string]> = [
  ["config/legal/terms.md", "ui/src/content/legal/terms.md"],
  ["config/legal/privacy.md", "ui/src/content/legal/privacy.md"],
  ["config/legal/code-of-conduct.md", "ui/src/content/legal/code-of-conduct.md"],
  [
    "config/legal/proposal-best-practices.md",
    "config/hubs/floyd/proposal-best-practices.md",
  ],
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
