/**
 * The loader mounts the packages' routes where app.ts mounted them by hand
 * (plugin session 1, ADR-014): every route the hub had before packages, from
 * commit e92804c (tests/fixtures/plugins/routes-before.json, written with the
 * same walk of the Express stack), is still mounted, nothing else was lost,
 * and routes that share a first path segment keep their relative order (a
 * drafts router before the "/:id" it would otherwise be taken for).
 *
 * Kept as a fixture test until the first package outside the nine lands: it is
 * the cheapest guard against a mount-order slip. A route added on purpose
 * after e92804c is listed in ADDED.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BEFORE: string[] = JSON.parse(readFileSync(join(here, "../fixtures/plugins/routes-before.json"), "utf8"));

/** Added on purpose since e92804c, each with why. */
const ADDED: Record<string, string> = {
  "GET /admin/hub/plugins/installs": "the Plugins page's installs (ADR-014)",
  "POST /admin/hub/plugins/:plugin/install": "Install (ADR-014)",
  "POST /admin/hub/plugins/:plugin/remove": "Remove: Stop now or Wind down (ADR-014)",
};

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  name?: string;
  regexp?: RegExp;
  handle?: { stack?: Layer[] };
}

function walk(stack: Layer[], prefix: string, out: string[]): string[] {
  for (const l of stack) {
    if (l.route) {
      for (const m of Object.keys(l.route.methods)) out.push(`${m.toUpperCase()} ${prefix}${l.route.path}`);
    } else if (l.name === "router" && l.handle?.stack) {
      const m = (l.regexp?.source ?? "").match(/^\^\\(\/[^?(]*?)\\\/\?\(\?=/);
      walk(l.handle.stack, prefix + (m ? m[1].replace(/\\\//g, "/") : ""), out);
    }
  }
  return out;
}

/** "/announcements/" (a router's "/") and "/announcements" (app.get) are one route. */
const norm = (r: string) => r.replace(/(.)\/$/, "$1");
const segment = (r: string) => r.split(" ")[1].split("/")[1] ?? "";

let now: string[] = [];

beforeAll(async () => {
  // The app reads its settings when it loads; nothing here reaches a database.
  process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "unit-test-key";
  const app = (await import("../../src/app.js")).default as unknown as { _router: { stack: Layer[] } };
  now = walk(app._router.stack, "", []).map(norm);
});

describe("the packages' routes are today's routes", () => {
  it("mounts every route the hub had before packages, and nothing it did not", () => {
    const before = new Set(BEFORE.map(norm));
    expect([...before].filter((r) => !now.includes(r)), "lost").toEqual([]);
    expect(now.filter((r) => !before.has(r) && !(r in ADDED)), "unexplained").toEqual([]);
  });

  it("keeps the relative order of routes that share a first path segment", () => {
    const before = BEFORE.map(norm);
    for (const seg of new Set(before.map(segment))) {
      const was = before.filter((r) => segment(r) === seg);
      const is = now.filter((r) => segment(r) === seg && was.includes(r));
      expect(is, `/${seg}`).toEqual(was);
    }
  });
});
