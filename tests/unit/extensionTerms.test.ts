import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXTENSION_TERMS } from "../../src/events/activitySerializer";

/**
 * Civic Activity Spec v0.2 §3.4: a space declares the extension terms it
 * emits, rather than leaving consumers to infer them. EXTENSION_TERMS is that
 * declaration, and /ns publishes it.
 *
 * The failure mode this guards is silent: someone adds a `hub:` type to the
 * mapping table, it goes out on the wire, and nothing declares it. The
 * mapping table's types are string literals inside builder closures, so the
 * only way to enumerate what CAN be emitted is to read the source — which is
 * exactly what a drift guard should do.
 */
const SERIALIZER_SRC = readFileSync(
  fileURLToPath(new URL("../../src/events/activitySerializer.ts", import.meta.url)),
  "utf8",
);

function emittedHubTerms(): string[] {
  // The whole file, register included: a term inside the register is declared
  // by definition and can never fail this check, so there is nothing to gain
  // from excluding it — and an exclusion that silently matches nothing makes
  // the guard vacuous, which is exactly what the first cut of this test did.
  const found = new Set<string>();
  for (const m of SERIALIZER_SRC.matchAll(/["'`](hub:[A-Za-z][A-Za-z0-9_]*)["'`]/g)) {
    found.add(m[1]);
  }
  return [...found].sort();
}

describe("extension terms are declared before they are emitted", () => {
  it("actually finds the terms — a guard that scans nothing proves nothing", () => {
    const seen = emittedHubTerms();
    expect(seen.length).toBeGreaterThanOrEqual(EXTENSION_TERMS.length);
    expect(seen).toContain("hub:ProjectSentiment");
  });

  it("declares every hub: term the serializer can put on the wire", () => {
    const declared = new Set(EXTENSION_TERMS.map((t) => t.term));
    const undeclared = emittedHubTerms().filter((t) => !declared.has(t));
    expect(undeclared).toEqual([]);
  });

  it("gives every declared term a kind and a reason", () => {
    for (const t of EXTENSION_TERMS) {
      expect(t.term).toMatch(/^hub:[A-Za-z][A-Za-z0-9_]*$/);
      expect(["object type", "property"]).toContain(t.kind);
      // The reason is what makes a term a promotion candidate rather than a
      // permanent private extension.
      expect(t.why.trim().length).toBeGreaterThan(20);
    }
  });

  it("never redefines an ActivityStreams or civic term", () => {
    // §3.4: "Extension terms MUST NOT redefine the semantics of AS2 or civic
    // terms." The hub: prefix is what keeps them separate, so the guard is
    // that no declared term escapes its own namespace.
    for (const t of EXTENSION_TERMS) {
      expect(t.term.startsWith("hub:")).toBe(true);
    }
  });
});
