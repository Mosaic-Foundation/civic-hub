// The console's page is served by vercel.json, which matches the request's
// host against a pattern: the server's CIVIC_CONSOLE_HOSTNAME alone does not
// make the console reachable. Every console hostname in use must be in both
// of vercel.json's console rules (the "/" redirect and the page rewrite), and
// no hub hostname may be.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));

const CONSOLE_HOSTS = [
  "console.civic.social", //          production
  "console.dev.civic.social", //      dev, since 2026-09-27
  "console-civic-hub-dev.vercel.app", // dev, before the dev wildcard
];
const NOT_CONSOLE = ["floyd.civic.social", "athens.dev.civic.social", "civic-hub-dev.vercel.app", "consolexcivic.social"];

type Rule = { has?: Array<{ type: string; value: string }> };
const consoleRules: Rule[] = [...vercel.redirects, ...vercel.rewrites].filter((r: Rule) =>
  r.has?.some((h) => h.type === "host"),
);

describe("vercel.json serves the console on its hostnames only", () => {
  it("has the redirect and the rewrite", () => {
    expect(consoleRules).toHaveLength(2);
  });

  for (const rule of consoleRules) {
    const pattern = new RegExp(rule.has!.find((h) => h.type === "host")!.value);
    it(`${pattern} matches every console hostname and no hub`, () => {
      for (const h of CONSOLE_HOSTS) expect(pattern.test(h), h).toBe(true);
      for (const h of NOT_CONSOLE) expect(pattern.test(h), h).toBe(false);
    });
  }
});
