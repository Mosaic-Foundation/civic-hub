/**
 * Navigation E2E tests.
 *
 * Verifies the core navigation flows a resident would use:
 * tab strip, hamburger drawer, page routing.
 */

import { test, expect } from "@playwright/test";
import { E2E_API_BASE } from "./hubApi";

// Dismiss the intro popup before each test by setting localStorage
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

test.describe("Navigation", () => {
  test("home page loads and nav is visible", async ({ page }) => {
    // beforeEach already navigated to / and dismissed the intro popup.
    // Just verify the nav is present.
    await expect(page.locator("nav.civic-nav")).toBeVisible({ timeout: 15_000 });
  });

  test("Feed and Votes tab strip navigates between pages", async ({ page }) => {
    const votesTab = page.locator('a[href="/votes"]').first();
    if (await votesTab.isVisible()) {
      await votesTab.click();
      await expect(page).toHaveURL("/votes");
    }

    const feedTab = page.locator('a[href="/"]').first();
    if (await feedTab.isVisible()) {
      await feedTab.click();
      await expect(page).toHaveURL("/");
    }
  });

  test("hamburger drawer opens and shows navigation links", async ({
    page,
  }) => {
    const hamburger = page.locator(".civic-nav-hamburger");
    if (await hamburger.isVisible()) {
      await hamburger.click();

      const drawer = page.locator(".civic-nav-drawer");
      await expect(drawer).toBeVisible();

      await expect(drawer.locator('a[href="/"]')).toBeVisible();
      await expect(drawer.locator('a[href="/votes"]')).toBeVisible();
    }
  });

  // The UI's beta state is the hub's own `hubs.mode` from /hub-config,
  // not a build-time env var (2026-09-26): the welcome dialog shows to a
  // signed-out first visit exactly when the served mode is beta.
  test("welcome dialog follows the served hub mode", async ({ page, request }) => {
    const config = await (await request.get(`${E2E_API_BASE}/hub-config`)).json();
    await page.evaluate(() => sessionStorage.removeItem("civic_preview"));
    await page.reload();
    await page.waitForLoadState("networkidle");
    const dialog = page.locator("dialog.beta-welcome");
    if (config.hub.mode === "beta") {
      await expect(dialog).toBeVisible();
    } else {
      await expect(dialog).toHaveCount(0);
    }
  });

  // Reading is public in beta: a signed-out visitor gets the same process
  // links from the drawer as from the tab strip. Before 2026-09-26 the
  // drawer greyed them out in beta while the tab strip worked. The local
  // stack's Floyd runs in beta, so this runs signed out in beta there.
  test("drawer process links work signed out, as the tab strip does", async ({
    page,
  }) => {
    const hamburger = page.locator(".civic-nav-hamburger");
    await expect(hamburger).toBeVisible({ timeout: 15_000 });
    await hamburger.click();

    const drawer = page.locator(".civic-nav-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.locator(".civic-nav-drawer-link-gated")).toHaveCount(0);

    await drawer.locator('a[href="/votes"]').click();
    await expect(page).toHaveURL("/votes");
    await expect(drawer).toBeHidden();
  });

  test("legal pages are accessible", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.locator("main")).toBeVisible();

    await page.goto("/terms");
    await expect(page.locator("main")).toBeVisible();

    await page.goto("/code-of-conduct");
    await expect(page.locator("main")).toBeVisible();
  });

  test("wordmark links to home", async ({ page }) => {
    await page.goto("/votes");
    await page.waitForLoadState("networkidle");

    const wordmark = page.locator(".civic-nav-wordmark, nav a[href='/']").first();
    if (await wordmark.isVisible()) {
      await wordmark.click();
      await expect(page).toHaveURL("/");
    }
  });
});
