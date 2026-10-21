/**
 * The activity `context` IRI (`<hub>/process/:id`) dereferences to the Civic
 * Process Descriptor for a consumer that asks for JSON-LD, and to the page
 * (through /api/og) for everyone else; a process's action endpoint reaches the
 * API. Both are vercel.json rewrites ahead of the page's (Architecture 2).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

type Rewrite = { source: string; destination: string; has?: Array<{ type: string; key?: string; value?: string }> };
const here = dirname(fileURLToPath(import.meta.url));
const rewrites = (JSON.parse(readFileSync(join(here, "../../vercel.json"), "utf8")) as { rewrites: Rewrite[] }).rewrites;
const index = (pred: (r: Rewrite) => boolean) => rewrites.findIndex(pred);

describe("the process IRI's routing", () => {
  const og = index((r) => r.source === "/process/:id*" && r.destination === "/api/og");
  const descriptor = index((r) => r.source === "/process/:id" && r.destination === "/api" && !!r.has);
  const action = index((r) => r.source === "/process/:id/action" && r.destination === "/api");

  it("sends the descriptor and the action endpoint to the API, before the page's rewrite", () => {
    expect(og).toBeGreaterThanOrEqual(0);
    expect(descriptor).toBeGreaterThanOrEqual(0);
    expect(action).toBeGreaterThanOrEqual(0);
    expect(descriptor).toBeLessThan(og);
    expect(action).toBeLessThan(og);
  });

  it("goes to the API only for a JSON-LD or ActivityStreams Accept", () => {
    const rule = rewrites[descriptor].has!.find((h) => h.type === "header" && h.key === "accept")!;
    const re = new RegExp(`^${rule.value}$`);
    for (const yes of [
      "application/ld+json",
      'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
      "application/activity+json",
      "application/activity+json, application/ld+json;q=0.9",
    ]) {
      expect(re.test(yes), yes).toBe(true);
    }
    for (const no of ["text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "*/*", "application/json"]) {
      expect(re.test(no), no).toBe(false);
    }
  });
});
