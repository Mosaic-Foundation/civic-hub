/**
 * The loader mounts the packages' routes where app.ts mounted them by hand
 * (plugin session 1, ADR-014): every route the hub had before packages, from
 * commit e92804c (tests/fixtures/plugins/routes-before.json, written with the
 * same walk of the Express stack), is still mounted, nothing else was lost,
 * and two routes that could answer the same request keep their relative order
 * (a drafts router before the "/:id" it would otherwise be taken for).
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
  "POST /admin/hub/plugins/:plugin/update": "Update to the version this deployment runs (ADR-015)",
  // Plugin Events (2026-10-27): its drafts, through the hub's drafts routes, and its calendar.
  "POST /calendar/drafts": "Events: a new event draft (the hub's drafts routes)",
  "GET /calendar/drafts": "Events: a resident's event drafts",
  "GET /calendar/drafts/:id": "Events: one event draft",
  "PATCH /calendar/drafts/:id": "Events: filling an event draft",
  "POST /calendar/drafts/:id/submit": "Events: submitting an event for review",
  "GET /calendar/events": "Events: the calendar, for its page",
  "GET /calendar/hub.ics": "Events: the calendar as iCalendar, to subscribe to",
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
/** Whether one request could reach both: same method, and each path's pattern matches the other's literal path. */
function overlap(a: string, b: string): boolean {
  const [ma, pa] = a.split(" ");
  const [mb, pb] = b.split(" ");
  if (ma !== mb) return false;
  const re = (p: string) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:\w+/g, "[^/]+")}$`);
  const literal = (p: string) => p.replace(/:\w+/g, "x");
  return re(pa).test(literal(pb)) || re(pb).test(literal(pa));
}

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

  it("keeps the relative order of any two routes that could answer the same request", () => {
    const before = BEFORE.map(norm);
    const problems: string[] = [];
    for (let i = 0; i < before.length; i++) {
      for (let j = i + 1; j < before.length; j++) {
        if (!overlap(before[i], before[j])) continue;
        const a = now.indexOf(before[i]);
        const b = now.indexOf(before[j]);
        if (a >= 0 && b >= 0 && a > b) problems.push(`${before[i]} is now after ${before[j]}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
