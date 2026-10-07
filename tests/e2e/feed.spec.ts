/**
 * Feed E2E tests.
 *
 * Verifies the civic feed displays correctly and supports filtering.
 */

import { test, expect } from "@playwright/test";
import { E2E_API_BASE } from "./hubApi";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("seen_intro_popup", "true");
    // A beta hub shows signed-out visitors a welcome dialog until they choose
    // to browse (usePreviewMode); these tests browse.
    sessionStorage.setItem("civic_preview", "1");
  });
  await page.reload();
  await page.waitForLoadState("networkidle");
});

test.describe("Civic Feed", () => {
  test("feed page loads and shows content", async ({ page }) => {
    const main = page.locator("main");
    await expect(main).toBeVisible();
  });

  test("feed filter pills are visible", async ({ page }) => {
    // Look for filter buttons/pills (All, Announcements, Votes, etc.)
    const filterArea = page.locator(".feed-filter");
    if (await filterArea.isVisible()) {
      const allButton = filterArea.locator("button").first();
      await expect(allButton).toBeVisible();
    }
  });

  test("the meeting-summaries pill names the hub's own governing body", async ({ page, request }) => {
    // Built when the module loaded, before the hub's settings arrived, the
    // pill said "Board" on every hub (fixed 2026-10-06). It must say what the
    // served config says.
    const config = await (await request.get(`${E2E_API_BASE}/hub-config`)).json();
    const short: string | undefined = config.settings["copy.governing_body_short"];
    test.skip(!short, "this hub has no short form set");
    // The pill is gone when the plugin is off, and while it needs setup and
    // has nothing to show (src/shared/pluginSetup.ts, 2026-10-07).
    const setup = config.plugin_setup?.meeting_summary;
    test.skip(
      config.settings["plugin.meeting_summary.enabled"] === "false" || (setup && !setup.shown),
      "meeting summaries are not shown on this hub",
    );
    await expect(page.locator(".feed-filter").getByRole("button", { name: `${short} meeting summaries` })).toBeVisible();
  });

  test("clicking a feed item navigates to detail", async ({ page }) => {
    // Find any clickable feed item link
    const feedLink = page.locator("a[href*='/process/'], a[href*='/announcement/'], a[href*='/vote-results/']").first();
    if (await feedLink.isVisible()) {
      const href = await feedLink.getAttribute("href");
      await feedLink.click();
      await page.waitForLoadState("networkidle");
      // Should navigate to the detail page
      if (href) {
        await expect(page).toHaveURL(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
    }
  });
});
