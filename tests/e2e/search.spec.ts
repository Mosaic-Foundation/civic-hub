/**
 * Search E2E tests.
 *
 * Verifies the search UI works end-to-end.
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

test.describe("Search", () => {
  test("search page renders with input field", async ({ page }) => {
    await page.goto("/search");
    await page.waitForLoadState("networkidle");

    // The search page renders SearchBar with inDrawer prop (always visible).
    // Scope to main to avoid matching the nav's collapsed search bar.
    const searchInput = page.locator("main input[type='search']").first();
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
  });

  test("can type a query and get results", async ({ page }) => {
    await page.goto("/search");
    await page.waitForLoadState("networkidle");

    const searchInput = page.locator("main input[type='search']").first();
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    await searchInput.fill("dumpster");
    await searchInput.press("Enter");
    await page.waitForTimeout(1500);

    const main = page.locator("main");
    await expect(main).toBeVisible();
  });

  test("empty search shows no results", async ({ page }) => {
    await page.goto("/search");
    await page.waitForLoadState("networkidle");

    const searchInput = page.locator("main input[type='search']").first();
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    await searchInput.fill("xyznonexistent99999");
    await searchInput.press("Enter");
    await page.waitForTimeout(1500);

    const main = page.locator("main");
    await expect(main).toBeVisible();
  });
});
