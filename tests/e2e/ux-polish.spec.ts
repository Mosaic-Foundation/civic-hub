/**
 * E2E tests for Step 2 punch-list UX polish.
 *
 * Covers: nav order, not-found back links, hub config strings,
 * finality warning copy in submission modals.
 */

import { test, expect } from "@playwright/test";
import { E2E_API_BASE } from "./hubApi";
import { theName } from "../../src/shared/hubCopy.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("seen_intro_popup", "true");
    // A beta hub shows signed-out visitors a welcome dialog until they choose
    // to browse (usePreviewMode); these tests browse.
    sessionStorage.setItem("civic_preview", "1");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
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

  // Fixed 2026-09-26: the strip now reads "Proposals" (not "Propose") and
  // ends with "Outcomes". Tabs whose plugin a hub switched off are hidden,
  // so the check is the canonical order of whichever tabs are present.
  test("tab strip links are in the correct order", async ({ page }) => {
    const tabStrip = page.locator(".feed-votes-tabs");
    await expect(tabStrip).toBeVisible();

    const labels = (await tabStrip.locator("a").allTextContents()).map((l) => l.trim());
    const canonical = ["Feed", "Conversations", "Proposals", "Votes", "Projects", "Outcomes"];
    expect(labels[0]).toBe("Feed");
    expect(labels).toEqual(canonical.filter((l) => labels.includes(l)));
    expect(labels.every((l) => canonical.includes(l))).toBe(true);
  });
});

// RETIRED 2026-09-26: "not-found shows back link" x3 (process, vote-results,
// wordcloud). The per-page back links were removed on purpose in 339b9ea
// (2026-06-22), when the tab strip moved into the App layout so every page,
// not-found ones included, carries the way back. What replaces them is the
// check of that intent: a not-found page renders, with the tab strip's Feed
// link.
test.describe("Not-found pages", () => {
  for (const path of [
    "/process/nonexistent-id-12345",
    "/vote-results/nonexistent-id-12345",
    "/wordcloud/nonexistent-id-12345",
  ]) {
    test(`${path.split("/")[1]} not-found keeps the tab strip's way home`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      await expect(page.getByText(/not found/i).first()).toBeVisible({ timeout: 10_000 });
      const home = page.locator(".feed-votes-tabs a[href='/']");
      await expect(home).toBeVisible();
      await home.click();
      await expect(page).toHaveURL("/");
    });
  }
});

test.describe("Hub config strings", () => {
  // Fixed 2026-09-26: the banner was reframed on purpose in 08ba02d
  // (2026-07-02) as "Welcome — the {hub.name} is a community pilot program".
  // The point of the check stays: the title carries the served hub name.
  test("welcome banner title carries the hub name", async ({ page, request }) => {
    const config = await (await request.get(`${E2E_API_BASE}/hub-config`)).json();
    const hubName: string = config.settings["identity.name"] ?? config.hub.name;

    await page.evaluate(() => {
      localStorage.removeItem("welcome-banner-dismissed-v2");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");

    const title = page.locator(".welcome-banner .welcome-banner-title");
    await expect(title).toBeVisible();
    // Since 2026-10-07 (review R17): "Welcome to the <hub>", no pilot program,
    // and the paragraph worded for the hub's kind — never another kind's.
    await expect(title).toHaveText(`Welcome to ${theName(hubName)}`);
    const body = page.locator(".welcome-banner .welcome-banner-body");
    await expect(body).not.toContainText("pilot program");
    if (config.settings["identity.jurisdiction_type"] !== "county") {
      await expect(body).not.toContainText("county government");
    }
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
