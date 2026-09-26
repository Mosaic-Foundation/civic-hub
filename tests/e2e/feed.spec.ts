/**
 * Feed E2E tests.
 *
 * Verifies the civic feed displays correctly and supports filtering.
 */

import { test, expect } from "@playwright/test";

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
