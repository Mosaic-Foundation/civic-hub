import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  applySubstitutions,
  substitutions,
} from "../../src/services/hubDocuments.js";
import type { Hub } from "../../src/models/hub.js";

// The documents are shared by every hub, with the place-specific names
// substituted. The thing that has to stay true is that Floyd's rendering
// matches the text it serves: templating is a refactor of how the words are
// stored, and must not change them by accident.
//
// THE GOLDEN COPIES MOVED, 2026-09-23. They used to be the `?raw` files in
// ui/src/content/legal/, which doubled as the UI's bundled fallback. Those
// are gone — a bundled fallback on a multi-hub deployment means serving one
// hub's terms under another hub's name — so the copies now live in
// tests/fixtures/ and are only ever a test's expectation.
//
// They were regenerated once, in that same session, when four lines changed
// on purpose: "the Board" became the hub's own governing body in three
// places and "the Commonwealth of Virginia" became "{STATE}", because a
// shared template cannot assume a commonwealth. Regenerating them is a
// deliberate act; if this test fails, find out which.

const FLOYD = {
  HUB_NAME: "Floyd Civic Hub",
  HOSTNAME: "floyd.civic.social",
  PLACE: "Floyd County",
  JURISDICTION: "Floyd County, Virginia",
  STATE: "Virginia",
  GOVERNING_BODY: "Board of Supervisors",
  OPERATOR: "Adam Lake",
  CONTACT_EMAIL: "contact@civic.social",
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
  ["config/legal/terms.md", "tests/fixtures/floyd-legal/terms.md"],
  ["config/legal/privacy.md", "tests/fixtures/floyd-legal/privacy.md"],
  ["config/legal/code-of-conduct.md", "tests/fixtures/floyd-legal/code-of-conduct.md"],
];

function sha(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

describe("shared legal documents", () => {
  it.each(PAIRS)(
    "%s renders byte-identical to Floyd's golden copy",
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

// --- No document may name a place, a person or a domain ----------------------
//
// The walkthrough that prompted this: Athens's Terms said it was "operated by
// Adam Lake", told residents to write to contact@civic.social, and described
// itself as being "at floyd.civic.social". Every one of those was true of
// Floyd and false of Athens, in a document whose whole job is to be true.
//
// So the shared templates carry no literal that belongs to one hub, and the
// test that says so runs on every push.

describe("no shared template names a hub, a person or a domain", () => {
  const SHARED = [
    "config/legal/terms.md",
    "config/legal/privacy.md",
    "config/legal/code-of-conduct.md",
    "config/legal/proposal-best-practices.md",
  ];

  it.each(SHARED)("%s contains no place, person or hostname literal", (path) => {
    const text = readFileSync(resolve(root, path), "utf-8");
    // Not an exhaustive list of every place name in the world — it is the
    // specific set that was found in these files, which is what a regression
    // would reintroduce.
    expect(text).not.toMatch(/Floyd/i);
    expect(text).not.toMatch(/Adam Lake/i);
    expect(text).not.toMatch(/Virginia/i);
    expect(text).not.toMatch(/Commonwealth/i);
    expect(text).not.toMatch(/civic\.social/i);
    // A bare domain of any kind: a document that names one names somebody's.
    expect(text).not.toMatch(/\b[a-z0-9-]+\.(gov|com|org|social)\b/i);
  });

  it.each(SHARED)("%s uses only placeholders a hub can fill", (path) => {
    const text = readFileSync(resolve(root, path), "utf-8");
    const names = new Set(
      [...text.matchAll(/\{([A-Z_]+)\}/g)].map((m) => m[1]),
    );
    // LIKE_THIS is the draft banner's illustration of a placeholder, not one.
    names.delete("LIKE_THIS");
    for (const name of names) {
      expect(Object.keys(FLOYD)).toContain(name);
    }
  });

  it("renders every shared document cleanly for a hub that is not Floyd", () => {
    const athens = {
      HUB_NAME: "Athens Civic Hub",
      HOSTNAME: "athens-civic-hub-dev.vercel.app",
      PLACE: "Athens",
      JURISDICTION: "Athens, Virginia",
      STATE: "Virginia",
      GOVERNING_BODY: "Town Council",
      OPERATOR: "Athens Moderator Group",
      CONTACT_EMAIL: "athens@example.com",
    };
    for (const path of SHARED) {
      const rendered = applySubstitutions(
        readFileSync(resolve(root, path), "utf-8"),
        athens,
      );
      expect(rendered, path).not.toMatch(/Floyd/i);
      expect(rendered, path).not.toMatch(/Adam Lake/i);
      expect(rendered, path).not.toMatch(/contact@civic\.social/i);
      // Every placeholder resolved — no `{OPERATOR}` left on a live page.
      expect(rendered.replace(/`\{LIKE_THIS\}`/g, ""), path).not.toMatch(
        /\{[A-Z_]+\}/,
      );
    }
  });
});

describe("the welcome essay belongs to the hub that wrote it", () => {
  it("is Floyd's own document, not a shared template", () => {
    // There is no config/welcome/ and there should not be. An introduction
    // naming a person, a county and 25 years of living there cannot be
    // substituted into something true of anywhere else, so a hub writes one
    // or has none. It used to be compiled into the UI bundle, which is how
    // Athens came to serve Floyd's.
    const floyd = readFileSync(
      resolve(root, "config/hubs/floyd/welcome.md"),
      "utf-8",
    );
    expect(floyd).toMatch(/Floyd/);
    // Its own hostname and contact address are still placeholders, so moving
    // the hub to another domain does not strand the text.
    expect(floyd).toMatch(/\{HOSTNAME\}/);
    expect(floyd).toMatch(/\{CONTACT_EMAIL\}/);
    expect(floyd).not.toMatch(/floyd\.civic\.social/);
  });
});

describe("a hub's substitutions come from its own row", () => {
  function hubRow(over: Partial<Hub>): Hub {
    return {
      id: "athens",
      hostname: "athens-civic-hub-dev.vercel.app",
      name: "Athens Civic Hub",
      jurisdiction_code: "us-va-athens",
      jurisdiction_name: "Athens, Virginia",
      space_did: "did:web:athens.example",
      space_type: "civic-hub",
      status: "active",
      mode: "demo",
      created_at: "2026-09-22T00:00:00Z",
      updated_at: "2026-09-22T00:00:00Z",
      ...over,
    };
  }

  it("takes HOSTNAME from the hubs row, never from an env var", () => {
    // The literal this replaces was "floyd.civic.social", written into the
    // terms. A hub's address is a column; nothing else may decide it.
    process.env.BASE_URL = "https://not-this-one.example";
    const values = substitutions(hubRow({}));
    expect(values.HOSTNAME).toBe("athens-civic-hub-dev.vercel.app");
    expect(values.HUB_NAME).toBe("Athens Civic Hub");
  });

  it("splits PLACE and STATE out of the jurisdiction name", () => {
    const values = substitutions(hubRow({ jurisdiction_name: "Athens, Virginia" }));
    expect(values.PLACE).toBe("Athens");
    expect(values.STATE).toBe("Virginia");
  });

  it("omits what the hub has not said, rather than guessing", () => {
    // Outside a request there is no settings snapshot, so the operator and
    // contact address are simply absent — and applySubstitutions then leaves
    // {OPERATOR} visible rather than rendering an empty phrase.
    const values = substitutions(hubRow({ jurisdiction_name: null }));
    expect(values.OPERATOR).toBeUndefined();
    expect(values.CONTACT_EMAIL).toBeUndefined();
    expect(values.PLACE).toBeUndefined();
    expect(applySubstitutions("operated by {OPERATOR}", values)).toBe(
      "operated by {OPERATOR}",
    );
  });
});
