/**
 * The design pass's audit (2026-10-28): every page type the hub draws, at
 * phone and desktop width, signed out and as an admin, under both navigation
 * layouts (and both colour modes once the hub has them), written as plain
 * PNGs to a folder for people to look at. It compares nothing; the committed
 * comparison is screenshots.spec.ts.
 *
 * LOCAL ONLY, on demand, on the `shots` hub (see screenshots.spec.ts):
 *
 *   CIVIC_E2E_DESIGN_AUDIT=<out dir> [CIVIC_E2E_DESIGN_MODES=light,dark] \
 *     [CIVIC_E2E_DESIGN_LOOKS=a,b] [CIVIC_E2E_DESIGN_PATHS=/,/admin/activity] \
 *     npx playwright test designAudit
 *
 * LOOKS photographs the design pass's directions (?look=a|b, while they are
 * on dev); PATHS photographs those pages only instead of finding them (an
 * admin path is taken as the admin only).
 *
 * The pages are found, not listed: the feed, then every link in the
 * navigation, the admin tabs and the settings rail, a detail page of each
 * type, and the "new" forms linked from the section pages. The run leaves the
 * hub's layout as it found it.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { localRest } from "../fixtures/adminSession.js";
import { adminEmailFor, session, visitAs } from "./actors";

const OUT = process.env.CIVIC_E2E_DESIGN_AUDIT?.trim() ?? "";
const MODES = (process.env.CIVIC_E2E_DESIGN_MODES?.trim() || "light").split(",");
const LOOKS = (process.env.CIVIC_E2E_DESIGN_LOOKS?.trim() || "").split(",");
const PATHS = process.env.CIVIC_E2E_DESIGN_PATHS?.trim().split(",").filter(Boolean) ?? [];
const HUB = "shots";
const PORT = new URL(process.env.CIVIC_E2E_BASE_URL?.trim() || "http://localhost:4173").port || "80";
const ORIGIN = `http://${HUB}.localhost:${PORT}`;
const LAYOUTS = ["top_tabs", "sidebar"] as const;
const WIDTHS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

function slug(path: string): string {
  return path.replace(/^\/+/, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/, "") || "feed";
}

async function setLayout(request: APIRequestContext, token: string, layout: string): Promise<void> {
  const res = await request.put(`${ORIGIN}/api/admin/hub/settings`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { section: "theme", values: { "nav.layout": layout } },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

async function currentLayout(request: APIRequestContext): Promise<string> {
  const config = await (await request.get(`${ORIGIN}/api/hub-config`)).json();
  return config.settings?.["nav.layout"] ?? "top_tabs";
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);
}

/** Same-origin paths linked from the page's navigation, admin tabs and settings rail. */
async function navPaths(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sel = "nav a[href], .admin-tabs a[href], [class*='settings'] nav a[href], [class*='rail'] a[href], [role='tablist'] a[href]";
    return [...document.querySelectorAll<HTMLAnchorElement>(sel)]
      .map((a) => new URL(a.href, location.href))
      .filter((u) => u.origin === location.origin)
      .map((u) => u.pathname);
  });
}

/** Links to create forms ("new", "propose", "post") on the page. */
async function createPaths(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLAnchorElement>("main a[href], a[href]")]
      .map((a) => new URL(a.href, location.href))
      .filter((u) => u.origin === location.origin && /\/(new|propose|post|create)(\/|$)/.test(u.pathname))
      .map((u) => u.pathname),
  );
}

test.describe("design audit", () => {
  test.skip(!OUT, "local only: CIVIC_E2E_DESIGN_AUDIT=<out dir>");
  test.setTimeout(30 * 60_000);

  test("every page type", async ({ browser, request }) => {
    const exists = (await localRest(`hubs?id=eq.${HUB}&select=id`)) as unknown[];
    expect(exists.length, "make the hub first: node --import tsx tests/e2e/screenshots/makeHub.ts").toBe(1);
    const adminToken = (await session(HUB, adminEmailFor(HUB))).token;
    const before = await currentLayout(request);

    // A detail page of each type, from its descriptor.
    const config = await (await request.get(`${ORIGIN}/api/hub-config`)).json();
    const details: string[] = [];
    for (const { type } of config.process_types as Array<{ type: string }>) {
      const [row] = (await localRest(
        `processes?select=id&hub_id=eq.${HUB}&type=eq.${type}&is_sample=eq.true&order=id.asc&limit=1`,
      )) as Array<{ id: string }>;
      if (!row) continue;
      const res = await request.get(`${ORIGIN}/api/process/${row.id}`, { headers: { Accept: "application/ld+json" } });
      if (res.ok()) details.push(new URL((await res.json()).endpoints.view as string).pathname);
    }

    try {
      for (const layout of LAYOUTS) {
        await setLayout(request, adminToken, layout);
        for (const mode of MODES) {
          for (const look of LOOKS) {
          for (const w of WIDTHS) {
            for (const who of ["resident", "admin"] as const) {
              const dir = join(OUT, `${look ? `look-${look}-` : ""}${layout}-${mode}`, who);
              mkdirSync(dir, { recursive: true });
              const ctx = await browser.newContext({
                viewport: { width: w.width, height: w.height },
                colorScheme: mode === "dark" ? "dark" : "light",
              });
              const page = await ctx.newPage();
              if (look) await page.addInitScript((l) => sessionStorage.setItem("civic_design_look", l), look);
              if (who === "admin") await visitAs(page, adminToken);
              else
                await page.addInitScript(() => {
                  localStorage.setItem("seen_intro_popup", "true");
                  localStorage.setItem("welcome-banner-dismissed-v2", "true");
                  sessionStorage.setItem("civic_preview", "1");
                });

              const seen = new Set<string>();
              const queue = PATHS.length
                ? PATHS.filter((p) => who === "admin" || !p.startsWith("/admin"))
                : ["/", ...details, ...(who === "admin" ? ["/admin", "/admin/settings", "/settings"] : [])];
              while (queue.length > 0) {
                const path = queue.shift()!;
                if (seen.has(path) || seen.size >= 120) continue;
                seen.add(path);
                const res = await page.goto(`${ORIGIN}${path}`).catch(() => null);
                if (!res) continue;
                await settle(page);
                await page.screenshot({ path: join(dir, `${slug(path)}-${w.name}.png`), fullPage: true });
                // Phones hide the section links in a sheet; the desktop pass finds them.
                const found = [...(await navPaths(page)), ...(await createPaths(page))];
                if (process.env.CIVIC_E2E_DESIGN_DEBUG) console.log(path, found.join(" "));
                for (const p of PATHS.length ? [] : found) {
                  if (!seen.has(p) && !p.startsWith("/sign-in")) queue.push(p);
                }
              }
              await ctx.close();
            }
          }
          }
        }
      }
    } finally {
      await setLayout(request, adminToken, before);
    }
  });
});
