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
const START_HOSTS = [
  "start.civic.social", //      production (CIVIC_START_HOSTNAME unset there until Adam opens it)
  "start.dev.civic.social", //  dev, since 2026-10-08 (session 4b)
];
const NOT_CONSOLE = [
  "floyd.civic.social",
  "athens.dev.civic.social",
  "civic-hub-dev.vercel.app",
  "consolexcivic.social",
  ...START_HOSTS,
];
const NOT_START = [
  "floyd.civic.social",
  "athens.dev.civic.social",
  "startxcivic.social",
  "start.floyd.civic.social",
  ...CONSOLE_HOSTS,
];

type Rule = { destination: string; has?: Array<{ type: string; value: string }> };
const hostRules: Rule[] = [...vercel.redirects, ...vercel.rewrites].filter((r: Rule) =>
  r.has?.some((h) => h.type === "host"),
);
const consoleRules = hostRules.filter((r) => r.destination === "/console.html");
const startRules = hostRules.filter((r) => r.destination === "/start.html");

describe("vercel.json serves the console on its hostnames only", () => {
  it("has the redirect and the rewrite, and no other host rule but the start page's", () => {
    expect(consoleRules).toHaveLength(2);
    expect(hostRules).toHaveLength(consoleRules.length + startRules.length);
  });

  for (const rule of consoleRules) {
    const pattern = new RegExp(rule.has!.find((h) => h.type === "host")!.value);
    it(`${pattern} matches every console hostname and no hub`, () => {
      for (const h of CONSOLE_HOSTS) expect(pattern.test(h), h).toBe(true);
      for (const h of NOT_CONSOLE) expect(pattern.test(h), h).toBe(false);
    });
  }
});

describe("vercel.json serves the start page on its hostnames only (session 4b)", () => {
  it("has the redirect and the rewrite", () => {
    expect(startRules).toHaveLength(2);
  });

  for (const rule of startRules) {
    const pattern = new RegExp(rule.has!.find((h) => h.type === "host")!.value);
    it(`${pattern} matches every start hostname, no hub and no console`, () => {
      for (const h of START_HOSTS) expect(pattern.test(h), h).toBe(true);
      for (const h of NOT_START) expect(pattern.test(h), h).toBe(false);
    });
  }

  it("comes before the catch-all that serves the hub app", () => {
    const rewrites = vercel.rewrites as Rule[];
    const last = rewrites.findIndex((r) => r.destination === "/index.html");
    for (const rule of startRules.filter((r) => rewrites.includes(r))) {
      expect(rewrites.indexOf(rule)).toBeLessThan(last);
    }
  });
});
