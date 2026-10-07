/**
 * Feed E2E tests.
 *
 * Verifies the civic feed displays correctly and supports filtering.
 */

import { test, expect, type Page } from "@playwright/test";
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

// Paged on the server since 2026-10-07: a page load fetches one page, and
// reaching the end of the feed (or "Load more") fetches the next with the
// cursor the last page returned.
test.describe("Feed paging", () => {
  test("a page load asks the server for one page, not the whole log", async ({ page }) => {
    const asked = page.waitForRequest((r) => /\/feed\?/.test(r.url()));
    await page.reload();
    const url = new URL((await asked).url());
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.has("cursor")).toBe(false);
    const res = await (await asked).response();
    const body = await res!.json();
    expect(body.events.length).toBeLessThanOrEqual(25);
    expect(body).toHaveProperty("next_cursor");
  });

  // Two pages served here, so the checks do not depend on how much a local
  // hub holds.
  const card = (n: number) => ({
    id: `evt_e2e_page_${n}`,
    version: "0.1",
    event_type: "civic.proposal.submitted",
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 60 - n)).toISOString(),
    process_id: `prop_e2e_page_${n}`,
    actor: "user:e2e",
    jurisdiction: "",
    action_url: "",
    source: { hub_id: "", hub_url: "" },
    data: { process: { type: "civic.proposal" }, proposal: { title: `Paged proposal ${n}` } },
    meta: { visibility: "public" },
  });

  async function servePages(page: Page): Promise<Array<string | null>> {
    const cursors: Array<string | null> = [];
    await page.route(/\/feed\?/, async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      cursors.push(cursor);
      const first = cursor === null;
      const events = first ? [1, 2, 3].map(card) : [4, 5].map(card);
      await route.fulfill({
        json: { events, count: events.length, process_meta: {}, next_cursor: first ? "c2" : null },
      });
    });
    return cursors;
  }

  test("scrolling to the end loads the next page, until the oldest", async ({ page }) => {
    const cursors = await servePages(page);
    await page.reload();
    const items = page.locator(".feed-list-item");
    // Three short cards leave the end of the feed on screen, so the next
    // page loads without a click.
    await expect(items).toHaveCount(5);
    await expect(items.last()).toContainText("Paged proposal 5");
    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
    // First pages carry no cursor (dev StrictMode may ask twice); the next
    // page is asked for once, with the cursor the first page returned.
    expect(cursors[0]).toBeNull();
    expect(cursors.filter((c) => c !== null)).toEqual(["c2"]);
  });

  test("without IntersectionObserver, the Load more button fetches the next page", async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
    });
    const cursors = await servePages(page);
    await page.reload();
    const items = page.locator(".feed-list-item");
    await expect(items).toHaveCount(3);
    await page.getByRole("button", { name: "Load more" }).click();
    await expect(items).toHaveCount(5);
    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
    expect(cursors.filter((c) => c !== null)).toEqual(["c2"]);
  });
});
