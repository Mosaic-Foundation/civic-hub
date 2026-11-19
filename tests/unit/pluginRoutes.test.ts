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
 *
 * Engine 2, C (2026-10-28): civic.vote_results is retired into briefs, so its
 * four /admin/vote-results routes were removed from routes-before.json (they
 * are gone on purpose). `GET /vote-results/:id` stays in it: the same route is
 * now the civic.brief package's legacy redirect (301 to ../brief/:id,
 * packages/civic.brief/legacyRoutes.ts), so old shared API links keep working.
 *
 * Kernel step 1, Conversations 0.4.0 (2026-11-17): POST
 * /deliberations/:processId/regenerate left the list. It reached into Briefs
 * (a conversation's summary is made again as its brief, POST
 * /admin/briefs/:id/regenerate), and nothing in the hub's pages called it.
 *
 * Kernel step 4, Feedback a plugin (2026-11-19): POST /upload/feedback-screenshot
 * left the list. The Feedback plugin mounts the same upload on its own path,
 * POST /feedback/screenshot (in ADDED).
 *
 * Kernel step 4, Members a plugin (2026-11-19): GET /members/summary,
 * GET /members/ and GET /admin/hub/members keep their paths, mounted now by
 * the Members plugin; POST /members/invites stays the kernel's.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// POST /votes/:id/claim-receipt left the list in the console slice (2026-11-10),
// with the bridge it read (active_vote_keys).
const BEFORE: string[] = JSON.parse(readFileSync(join(here, "../fixtures/plugins/routes-before.json"), "utf8"));

/** Added on purpose since e92804c, each with why. */
const ADDED: Record<string, string> = {
  // Districts and demographics (2026-11-16): a member's own About-you answers.
  "GET /user/about": "Your own About-you answers, and whether you were asked",
  "PUT /user/about": "Save your About-you answers",
  "POST /user/about/asked": "The one-time About-you card was shown",
  "POST /user/about/district-lookup": "Find your district by address (the Census geocoder; the address is not kept)",
  "POST /user/about/address-suggestions": "Address suggestions as a member types (Mapbox, through the server; nothing is kept)",
  "GET /admin/hub/districts/census": "Settings > Districts: the county's subdivisions from the Census, to fill the list",
  "GET /process/:id/breakdowns": "A finished process's totals by district, age group or race; groups under 5 hidden",
  // News Sync posts shown as News (2026-11-16): Admin → Announcements' synced rows.
  "GET /admin/news-sync/items": "Admin → Announcements: News Sync's posts, each with its source and how it shows",
  // The console split (2026-11-11): the front door that served it is gone, so
  // the hub app mounts the browsers' error reports itself (it always answered them).
  "POST /client-errors": "a browser's error report (src/http/clientErrors.ts), before hub resolution",
  // The console split (2026-11-10): the operator API, 404 unless CIVIC_OPERATOR_TOKEN is set.
  "POST /operator/rpc/:method": "the console's calls to the hub deployment (src/operator/api.ts)",
  // The layout session (2026-11-07; ADR-019) added GET /aside and GET /api/aside,
  // the right column's facts. Kernel step 4 (2026-11-19) removed them: their
  // last fact, the member count, is the Members plugin's (GET /members/summary).
  // Events 4 (2026-11-09): what is about to close, for the feed's closing-soon cards.
  "GET /feed/closing": "open processes closing within 48 hours: titles, close times and links",
  "GET /api/feed/closing": "the same, at the URL the UI reads locally (Vercel strips /api)",
  // Sample content for demo and beta hubs (2026-11-05).
  "POST /admin/hub/sample-content/refresh": "Settings → Sample content: Refresh samples",
  "POST /admin/hub/sample-content/auto-refresh": "Settings → Sample content: Keep sample content fresh automatically",
  // Pilot readiness 2 (2026-11-02): the home page's "Set up your hub" card.
  "GET /admin/hub/setup-card": "the admin's setup card: its ticks",
  "POST /admin/hub/setup-card": "the admin's setup card: Dismiss and Skip",
  "GET /admin/hub/plugins/installs": "the Plugins page's installs (ADR-014)",
  "POST /admin/hub/plugins/:plugin/install": "Install (ADR-014)",
  "POST /admin/hub/plugins/:plugin/remove": "Remove: Stop now or Wind down (ADR-014)",
  "POST /admin/hub/plugins/:plugin/update": "Update to the version this deployment runs (ADR-015)",
  // The Activity feature package (ADR-016).
  "GET /analytics": "the hub's numbers, public when Public numbers is on or with a reporting key",
  "GET /admin/analytics": "Admin → Activity's report",
  "GET /admin/analytics/csv": "Admin → Activity's CSV",
  "POST /admin/analytics/refresh": "Admin → Activity's Recount now",
  // A person's own settings (design pass, 2026-10-29, decisions 9 and 15).
  "GET /unsubscribe/notices": "a notice's one-click link stops notices only",
  "PATCH /user/settings/notices": "Notices about things I take part in, on or off",
  "PATCH /user/settings/appearance": "Your look: light, dark or follow the device",
  "PATCH /user/settings/mastodon": "Your Mastodon handle, for Share on Mastodon (2026-11-15)",
  "GET /admin/analytics/keys": "the reporting keys and their read log",
  "POST /admin/analytics/keys": "issue a reporting key",
  "POST /admin/analytics/keys/:id/revoke": "revoke a reporting key",
  "GET /internal/analytics/run": "the Activity job",
  // The Fediverse feature (2026-11-13): its Plugins panel. Its account answers
  // on root paths (WebFinger, NodeInfo, /ap) through a root handler, not a route.
  "GET /admin/fediverse": "the Fediverse panel's handle and follower count",
  "GET /admin/fediverse/followers": "Admin → Activity's Fediverse card: followers, and new in a period",
  "GET /fediverse/posts/:id": "a fediverse post's roundup list, for its page on the hub",
  "GET /fediverse/posts": "the hub's fediverse post about a process, for Share on Mastodon to open",
  "GET /internal/fediverse/run": "the Fediverse job",
  "POST /admin/fediverse/run": "the Fediverse panel's Post now: the job's run for this hub, at once",
  // Plugin Events (2026-10-27): its drafts, through the hub's drafts routes, and its calendar.
  "POST /calendar/drafts": "Events: a new event draft (the hub's drafts routes)",
  "GET /calendar/drafts": "Events: a resident's event drafts",
  "GET /calendar/drafts/:id": "Events: one event draft",
  "PATCH /calendar/drafts/:id": "Events: filling an event draft",
  "POST /calendar/drafts/:id/submit": "Events: submitting an event for review",
  "GET /calendar/events": "Events: the calendar, for its page",
  "GET /calendar/events/:id/going": "Events: how many are going, and who as the hub discloses it (engine 2, A3)",
  "GET /calendar/hub.ics": "Events: the calendar as iCalendar, to subscribe to",
  // Events 2 (2026-10-28): a type's own images (E1), one event's calendar file, its messages for admins.
  "POST /upload/process-image/:type": "an image a type's residents attach, for a type that declares uploads (E1)",
  "GET /calendar/events/:id.ics": "Events: one event's calendar file (Add to my calendar)",
  "GET /calendar/events/:id/announcements": "Events: what the people going were sent, for admins",
  // Pinning any item (2026-11-18): the kernel's, beside archive and restore.
  "GET /pins": "the Pinning plugin's card: what is pinned, the urgent line, whether the reader may pin",
  "GET /pins/:id": "an item's pin, for its Pin button",
  "POST /pins/:id": "pin an item, or change its end date or urgent flag",
  "DELETE /pins/:id": "unpin an item",
  "GET /admin/pins": "Admin → Pinned: everything pinned",
  // Feedback a plugin (kernel step 4, 2026-11-19): its screenshot upload on its own path.
  "POST /feedback/screenshot": "Feedback: a screenshot for a bug report (signed in), the kernel's image upload",
  // News Sync's own type (2026-11-18): a News item's page reads it.
  "GET /news/:id": "News sync: one News item, for its page",
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
