/**
 * Before/after screenshots of the hub's pages (frontend pass, 2026-10-24):
 * the home page, a detail page of every type, the admin queue, Activity and
 * the settings page, at phone and desktop width, signed out and as an admin.
 * The design pass (2026-10-29, ADR-018) took new images and added the other
 * layout and the dark mode at desktop width: the home page, a vote, the
 * admin queue, Activity and Appearance, signed out and as an admin.
 * A change meant to leave the UI as it was (a refactor) is checked against
 * the committed images in tests/e2e/screenshots/.
 *
 * LOCAL ONLY, on demand: fonts and anti-aliasing differ between machines, so
 * the images are only comparable on the machine that took them. CI skips it.
 *
 *   ./scripts/local-stack.sh reset          # the fixture set, nothing else
 *   node --import tsx tests/e2e/screenshots/makeHub.ts
 *   (API on :3000 and a preview on :4173, as e2e.yml starts them)
 *   CIVIC_E2E_SCREENSHOTS=1 CIVIC_E2E_BASE_URL=http://localhost:4173 \
 *     npx playwright test screenshots [--update-snapshots]
 *
 * The pages are a hub of its own, `shots` (shots.localhost) with the sample
 * content: fixed titles and text, so two runs show the same thing. It is made
 * before the run, not by it, so the run does not delete it (dropTestHubs) and
 * the next run sees the same hub; `reset` takes it away. Times are masked
 * ("3 minutes ago" moves between runs).
 */

import { test, expect, type Page } from "@playwright/test";
import { localRest } from "../fixtures/adminSession.js";
import { adminEmailFor, session, visitAs } from "./actors";

const ON = process.env.CIVIC_E2E_SCREENSHOTS === "1";
const HUB = "shots";
const PORT = new URL(process.env.CIVIC_E2E_BASE_URL?.trim() || "http://localhost:4173").port || "80";
const ORIGIN = `http://${HUB}.localhost:${PORT}`;

const WIDTHS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  // Lazy images and the feed's first page.
  await page.waitForTimeout(400);
}

async function shoot(page: Page, name: string): Promise<void> {
  await settle(page);
  // Soft: one run reports every page that differs, not only the first.
  await expect.soft(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    mask: [page.locator("time"), page.locator(".feed-post-time, .relative-time")],
    maxDiffPixelRatio: 0.002,
  });
}

test.describe("screenshots", () => {
  test.skip(!ON, "local only: CIVIC_E2E_SCREENSHOTS=1");

  let paths: Array<{ type: string; path: string }> = [];
  let adminToken = "";

  test.beforeAll(async ({ request }) => {
    const exists = (await localRest(`hubs?id=eq.${HUB}&select=id`)) as unknown[];
    expect(exists.length, "make the hub first: node --import tsx tests/e2e/screenshots/makeHub.ts").toBe(1);
    adminToken = (await session(HUB, adminEmailFor(HUB))).token;
    const config = await (await request.get(`${ORIGIN}/api/hub-config`)).json();
    const types = (config.process_types as Array<{ type: string }>).map((t) => t.type);
    paths = [];
    for (const type of types) {
      const [row] = (await localRest(
        `processes?select=id&hub_id=eq.${HUB}&type=eq.${type}&is_sample=eq.true&order=id.asc&limit=1`,
      )) as Array<{ id: string }>;
      if (!row) continue;
      const res = await request.get(`${ORIGIN}/api/process/${row.id}`, { headers: { Accept: "application/ld+json" } });
      if (!res.ok()) continue;
      paths.push({ type, path: new URL((await res.json()).endpoints.view as string).pathname });
    }
    expect(paths.length).toBeGreaterThanOrEqual(6);
  });

  for (const w of WIDTHS) {
    test(`signed out, ${w.name}`, async ({ page }) => {
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.addInitScript(() => {
        localStorage.setItem("seen_intro_popup", "true");
        localStorage.setItem("welcome-banner-dismissed-v2", "true");
        sessionStorage.setItem("civic_preview", "1");
      });
      await page.goto(`${ORIGIN}/`);
      await shoot(page, `home-${w.name}`);
      for (const p of paths) {
        await page.goto(`${ORIGIN}${p.path}`);
        await shoot(page, `${p.type.replace(/^civic\./, "")}-${w.name}`);
      }
    });

    test(`admin, ${w.name}`, async ({ page }) => {
      await page.setViewportSize({ width: w.width, height: w.height });
      await visitAs(page, adminToken);
      await page.goto(`${ORIGIN}/`);
      await shoot(page, `admin-home-${w.name}`);
      await page.goto(`${ORIGIN}/admin/reviews`);
      await shoot(page, `admin-queue-${w.name}`);
      await page.goto(`${ORIGIN}/admin/activity`);
      await shoot(page, `admin-activity-${w.name}`);
      await page.goto(`${ORIGIN}/admin/settings`);
      await shoot(page, `admin-settings-${w.name}`);
    });
  }

  // The left-column layout and the dark mode, at desktop width (ADR-018).
  const VARIANTS = [
    { name: "sidebar", layout: "sidebar", mode: "light" },
    { name: "dark", layout: "top_tabs", mode: "dark" },
  ] as const;
  for (const v of VARIANTS) {
    test(`${v.name}: signed out and admin, desktop`, async ({ page, request }) => {
      const auth = { Authorization: `Bearer ${adminToken}` };
      const set = (layout: string) =>
        request.put(`${ORIGIN}/api/admin/hub/settings`, { headers: auth, data: { section: "theme", values: { "nav.layout": layout } } });
      const appearance = (mode: string) =>
        request.patch(`${ORIGIN}/api/user/settings/appearance`, { headers: auth, data: { appearance: mode } });
      expect((await set(v.layout)).ok()).toBe(true);
      expect((await appearance(v.mode)).ok()).toBe(true);
      try {
        await page.setViewportSize({ width: 1280, height: 900 });
        // A signed-out reader follows the device.
        await page.emulateMedia({ colorScheme: v.mode });
        await page.addInitScript(() => {
          localStorage.setItem("seen_intro_popup", "true");
          localStorage.setItem("welcome-banner-dismissed-v2", "true");
          sessionStorage.setItem("civic_preview", "1");
        });
        await page.goto(`${ORIGIN}/`);
        await shoot(page, `${v.name}-home-desktop`);
        const vote = paths.find((p) => p.type === "civic.vote");
        if (vote) {
          await page.goto(`${ORIGIN}${vote.path}`);
          await shoot(page, `${v.name}-vote-desktop`);
        }
        // The admin's own Appearance decides theirs.
        await visitAs(page, adminToken);
        for (const [path, name] of [
          ["/admin/reviews", "admin-queue"],
          ["/admin/activity", "admin-activity"],
          ["/admin/settings/theme", "admin-appearance"],
        ] as const) {
          await page.goto(`${ORIGIN}${path}`);
          await shoot(page, `${v.name}-${name}-desktop`);
        }
      } finally {
        await set("top_tabs");
        await appearance("light");
      }
    });
  }
});
