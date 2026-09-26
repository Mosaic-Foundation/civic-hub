/**
 * Votes page E2E tests.
 *
 * Verifies the votes listing and individual vote process views.
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

test.describe("Votes Page", () => {
  test("votes page loads and shows content", async ({ page }) => {
    await page.goto("/votes");
    await page.waitForLoadState("networkidle");

    const main = page.locator("main");
    await expect(main).toBeVisible();
  });

  test("vote status filter pills are visible", async ({ page }) => {
    await page.goto("/votes");
    await page.waitForLoadState("networkidle");

    const filterArea = page.locator(".votes-filter");
    if (await filterArea.isVisible()) {
      const buttons = filterArea.locator("button");
      const count = await buttons.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  // Fixed 2026-09-26: the large .suggest-vote-cta card became a compact
  // header button in 7606a04 (2026-06-20).
  test("suggest-a-vote button is on the votes page", async ({ page }) => {
    await page.goto("/votes");
    await page.waitForLoadState("networkidle");

    const button = page.locator(".section-header-row").getByRole("button", { name: "Suggest a vote" });
    await expect(button).toBeVisible({ timeout: 10_000 });
  });

  test("clicking a vote card navigates to process detail", async ({
    page,
  }) => {
    await page.goto("/votes");
    await page.waitForLoadState("networkidle");

    const voteLink = page
      .locator("a[href*='/process/']")
      .first();
    if (await voteLink.isVisible()) {
      await voteLink.click();
      await expect(page).toHaveURL(/\/process\//);
      const main = page.locator("main");
      await expect(main).toBeVisible();
    }
  });
});
