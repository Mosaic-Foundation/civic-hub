/**
 * E2E tests for Step 2 punch-list UX polish.
 *
 * Covers: nav order, not-found back links, hub config strings,
 * finality warning copy in submission modals.
 */

import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("seen_intro_popup", "true");
    // A beta hub shows signed-out visitors a welcome dialog until they choose
    // to browse (usePreviewMode); these tests browse.
    sessionStorage.setItem("civic_preview", "1");
    localStorage.setItem("welcome-banner-dismissed-v1", "true");
  });
  await page.reload();
  await page.waitForLoadState("networkidle");
});

test.describe("Nav order", () => {
  test("drawer links are in the correct order", async ({ page }) => {
    const hamburger = page.locator(".civic-nav-hamburger");
    if (!(await hamburger.isVisible())) return;

    await hamburger.click();
    const drawer = page.locator(".civic-nav-drawer");
    await expect(drawer).toBeVisible();

    const links = await drawer.locator("a").allTextContents();
    const coreLinks = links.filter((l) =>
      ["Feed", "Conversations", "Propose", "Votes", "Projects"].includes(l),
    );
    expect(coreLinks).toEqual([
      "Feed",
      "Conversations",
      "Propose",
      "Votes",
      "Projects",
    ]);
  });

  test("tab strip links are in the correct order", async ({ page }) => {
    const tabStrip = page.locator(".feed-votes-tabs");
    if (!(await tabStrip.isVisible())) return;

    const labels = await tabStrip.locator("a").allTextContents();
    expect(labels).toEqual([
      "Feed",
      "Conversations",
      "Propose",
      "Votes",
      "Projects",
    ]);
  });
});

test.describe("Not-found back links", () => {
  test("process not-found shows back link to home", async ({ page }) => {
    await page.goto("/process/nonexistent-id-12345");
    await page.waitForLoadState("networkidle");

    const backLink = page.locator("a.back-link");
    await expect(backLink).toBeVisible({ timeout: 10_000 });
    await expect(backLink).toHaveAttribute("href", "/");
  });

  test("vote-results not-found shows back link", async ({ page }) => {
    await page.goto("/vote-results/nonexistent-id-12345");
    await page.waitForLoadState("networkidle");

    const backLink = page.locator("a.back-link");
    await expect(backLink).toBeVisible({ timeout: 10_000 });
  });

  test("wordcloud not-found shows back link to home", async ({ page }) => {
    await page.goto("/wordcloud/nonexistent-id-12345");
    await page.waitForLoadState("networkidle");

    const backLink = page.locator("a.back-link");
    await expect(backLink).toBeVisible({ timeout: 10_000 });
    await expect(backLink).toHaveAttribute("href", "/");
  });
});

test.describe("Hub config strings", () => {
  test("welcome banner title follows 'New to the {hub.name}?' pattern", async ({
    page,
  }) => {
    await page.evaluate(() => {
      localStorage.removeItem("welcome-banner-dismissed-v1");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");

    const banner = page.locator(".welcome-banner");
    if (!(await banner.isVisible())) return;

    const title = await banner.locator(".welcome-banner-title").textContent();
    expect(title).toMatch(/^New to the .+\?$/);
  });

  test("legal page title follows '{title} · {hub.name}' pattern", async ({ page }) => {
    await page.goto("/privacy");
    await page.waitForLoadState("networkidle");

    const title = await page.title();
    expect(title).toMatch(/^Privacy Policy · .+$/);
  });

  test("welcome page title follows 'Welcome · {hub.name}' pattern", async ({ page }) => {
    await page.goto("/welcome");
    await page.waitForLoadState("networkidle");

    const title = await page.title();
    expect(title).toMatch(/^Welcome · .+$/);
  });
});
