/**
 * The admin rail (pilot readiness 3, Adam 2026-11-06).
 *
 * 5. Admin always uses the left rail, whatever the public layout: the hub
 *    header stays, "Back to the hub" and "Admin" head the rail, the public
 *    section tabs are hidden, and there is no admin bar. A phone keeps its
 *    bottom bar and opens the rail as a drawer from the Admin button.
 * 6. (Nov 6) The rail fitted 768px without scrolling. Dropped on Nov 7
 *    (ADR-018's amendment): the rail is dark, roomier, and may scroll; the
 *    current item is kept in view. Review, Community and Hub settings fold
 *    with a chevron; the group holding the page opens; what you open is
 *    remembered in the browser; "Back to the hub" stays at the top as the
 *    rail scrolls. The phone drawer has the same look, and while
 *    you type on a phone the bottom bar hides and the Save bar is one line.
 *
 * Acts on whichever hub `localhost` resolves to (Athens on the local stack
 * with CI's env), as its admin. Nothing it changes is left changed: the
 * layout is put back through the API.
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { storedSetting } from "../fixtures/adminSession.js";
import { adminEmailFor, hubId, session, visitAs } from "./actors";
import { E2E_API_BASE as API } from "./hubApi";

const SHORT = { width: 1280, height: 768 };
const PHONE = { width: 375, height: 812 };

let hub = "";
let adminToken = "";
let layoutBefore: string | undefined;

const rail = (page: Page) => page.getByRole("navigation", { name: "Admin sections" });

async function setLayout(request: APIRequestContext, value: string) {
  const res = await request.put(`${API}/admin/hub/settings`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { section: "theme", values: { "nav.layout": value } },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  hub = await hubId(request);
  adminToken = (await session(hub, adminEmailFor(hub))).token;
  layoutBefore = await storedSetting(hub, "nav.layout");
});

test.afterAll(async ({ request }) => {
  await setLayout(request, layoutBefore ?? "");
});

for (const layout of ["top_tabs", "sidebar"]) {
  test(`with ${layout} public navigation, admin is the left rail under the hub header`, async ({ page, request }) => {
    await setLayout(request, layout);
    await page.setViewportSize(SHORT);
    await visitAs(page, adminToken);
    await page.goto("/admin/reviews");
    await expect(rail(page)).toBeVisible();
    await expect(page.locator(".civic-nav")).toBeVisible();
    await expect(page.locator(".feed-votes-tabs")).toBeHidden();
    await expect(page.locator(".admin-bar")).toHaveCount(0);
    await expect(rail(page).getByRole("link").first()).toHaveText("Back to the hub");
    await expect(rail(page).getByRole("heading", { level: 2 })).toHaveText("Admin");
    await expect(rail(page).getByRole("heading", { level: 3 })).toHaveText([/^Review/, /^Community/, /^Hub settings/]);
    await expect(rail(page).locator('[data-nav-id="processes"]')).toHaveAttribute("aria-current", "page");
    // Hub settings' sections are not open outside it.
    await expect(rail(page).getByRole("navigation", { name: "Hub settings sections" })).toHaveCount(0);

    // Back to the hub: the public layout returns.
    await rail(page).getByRole("link", { name: "Back to the hub" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(rail(page)).toHaveCount(0);
    if (layout === "top_tabs") await expect(page.locator(".feed-votes-tabs")).toBeVisible();
    // Dark means admin: the public left column stays light.
    if (layout === "sidebar") expect(await luminanceOf(page, ".hub-sidebar")).toBeGreaterThan(0.8);
  });
}

/** The relative luminance of an element's background, 0 (black) to 1 (white). */
async function luminanceOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    const bg = getComputedStyle(el).backgroundColor;
    // A color-mix() comes back as color(srgb r g b) in 0..1; rgb() in 0..255.
    const scale = bg.startsWith("color(") ? 255 : 1;
    const m = bg.match(/[\d.]+/g)!.map((n) => Number(n) * scale);
    const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(m[0]!) + 0.7152 * lin(m[1]!) + 0.0722 * lin(m[2]!);
  });
}

test("the rail is dark, its groups fold and are remembered, and every row is the same size", async ({ page, request }) => {
  await setLayout(request, "top_tabs");
  await page.setViewportSize(SHORT);
  await visitAs(page, adminToken);
  await page.goto("/admin/reviews");
  expect(await luminanceOf(page, ".hub-sidebar")).toBeLessThan(0.05);
  const community = rail(page).getByRole("button", { name: /^Community/ });
  const review = rail(page).getByRole("button", { name: /^Review/ });
  await expect(review).toHaveAttribute("aria-expanded", "true");
  await expect(community).toHaveAttribute("aria-expanded", "false");
  await expect(rail(page).locator('[data-nav-id="moderation"]')).toBeHidden();
  await community.click();
  await expect(rail(page).locator('[data-nav-id="moderation"]')).toBeVisible();
  // Remembered in this browser.
  await page.reload();
  await expect(rail(page).getByRole("button", { name: /^Community/ })).toHaveAttribute("aria-expanded", "true");
  // Hub settings' sections are the same size as the other rows.
  await page.goto("/admin/settings/identity");
  const fontSize = (el: Element) => getComputedStyle(el).fontSize;
  const section = rail(page).getByRole("link", { name: "Identity", exact: true });
  await expect(section).toBeVisible();
  const item = rail(page).locator('[data-nav-id="processes"]');
  await expect(item).toBeVisible();
  expect(await section.evaluate(fontSize)).toBe(await item.evaluate(fontSize));
});

test("on a short window the rail scrolls and keeps the page's item in view", async ({ page, request }) => {
  await setLayout(request, "top_tabs");
  // Every plugin that adds an admin item on, so the rail is as long as it gets.
  const plugins = ["brief", "meeting_summary", "feedback", "analytics"].map((p) => `plugin.${p}.enabled`);
  const before = await Promise.all(plugins.map((k) => storedSetting(hub, k)));
  const putPlugins = (values: Record<string, string>) =>
    request.put(`${API}/admin/hub/settings`, { headers: { Authorization: `Bearer ${adminToken}` }, data: { section: "plugins", values } });
  expect((await putPlugins(Object.fromEntries(plugins.map((k) => [k, "true"])))).ok()).toBeTruthy();
  try {
    await page.setViewportSize({ width: 1280, height: 600 });
    await visitAs(page, adminToken);
    // Every group open, so the rail is longer than the window.
    await page.goto("/admin/reviews");
    await rail(page).getByRole("button", { name: /^Community/ }).click();
    await page.goto("/admin/settings/plugins");
    const sections = rail(page).getByRole("navigation", { name: "Hub settings sections" });
    const current = sections.getByRole("link", { name: "Plugins" });
    await expect(current).toHaveAttribute("aria-current", "page");
    const fit = await page.locator(".hub-sidebar").evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(fit.scroll, "the rail is longer than the window here").toBeGreaterThan(fit.client);
    await expect(current).toBeInViewport();
    // Scrolled to its foot, the rail keeps "Back to the hub" at its top (Adam, 2026-11-07).
    const column = page.locator(".hub-sidebar");
    await column.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const back = rail(page).getByRole("link", { name: "Back to the hub" });
    await expect(back).toBeInViewport();
    const top = (await column.boundingBox())!.y;
    expect((await back.boundingBox())!.y - top).toBeLessThan(32);
    // Nothing shows through above it: the band is the rail's colour.
    expect(await page.locator(".admin-rail-top").evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
    for (const id of ["processes", "briefs", "meeting-summaries", "edits", "admin-feedback", "analytics", "moderation", "archived", "setup-guide", "contact"]) {
      await expect(rail(page).locator(`[data-nav-id="${id}"]`)).toHaveCount(1);
    }
  } finally {
    // An unset switch reads as its default, which is on for these.
    await putPlugins(Object.fromEntries(plugins.map((k, i) => [k, before[i] ?? "true"])));
  }
});

test("a phone keeps its bottom bar and opens the rail as a drawer from the Admin button", async ({ page, request }) => {
  await setLayout(request, "sidebar");
  await page.setViewportSize(PHONE);
  await visitAs(page, adminToken);
  await page.goto("/admin/moderation");
  await expect(page.getByRole("navigation", { name: "Sections", exact: true })).toBeVisible();
  await expect(rail(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Admin" });
  await expect(drawer).toBeVisible();
  await expect(rail(page)).toBeVisible();
  // The same dark rail; Moderation's group is open, Review starts closed.
  expect(await luminanceOf(page, ".admin-drawer-body")).toBeLessThan(0.05);
  await expect(drawer.getByRole("button", { name: /^Community/ })).toHaveAttribute("aria-expanded", "true");
  await drawer.getByRole("button", { name: /^Review/ }).click();
  // Scrolled to its foot, the drawer keeps "Back to the hub" at its top.
  await page.locator(".admin-drawer-body").evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(drawer.getByRole("link", { name: "Back to the hub" })).toBeInViewport();
  await drawer.getByRole("link", { name: /^Edits/ }).click();
  await expect(page).toHaveURL(/\/admin\/edits$/);
  await expect(drawer).toHaveCount(0);
  // Escape closes it, and focus returns to the button.
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Admin", exact: true })).toBeFocused();
  // No sideways scroll at phone width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("Setup guide opens Hub settings → Getting started: every step with its tick, its setting and its docs page", async ({ page, request }) => {
  await setLayout(request, "top_tabs");
  await page.setViewportSize(SHORT);
  await visitAs(page, adminToken);
  await page.goto("/admin/reviews");
  await rail(page).getByRole("link", { name: "Setup guide" }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/getting-started$/);
  await expect(page.getByRole("heading", { name: "Getting started" })).toBeVisible();
  // First in Hub settings, and current in the rail's sections.
  const sections = rail(page).getByRole("navigation", { name: "Hub settings sections" });
  await expect(sections.getByRole("link").first()).toHaveText("Getting started");
  await expect(sections.getByRole("link", { name: "Getting started" })).toHaveAttribute("aria-current", "page");
  const steps = page.locator(".getting-started-step");
  await expect(steps).toHaveCount(11);
  await expect(page.getByText(/^\d+ of 11 done$/)).toBeVisible();
  for (const step of await steps.all()) {
    await expect(step.locator("a.getting-started-label")).toHaveAttribute("href", /^\/admin\/settings\/[a-z-]+$/);
    await expect(step.locator("a.getting-started-docs")).toHaveAttribute("href", /^https:\/\/docs\.civic\.social\//);
  }
});

test("on a phone, typing hides the bottom bar and folds the Save bar to one line", async ({ page, request }) => {
  await setLayout(request, "top_tabs");
  await page.setViewportSize(PHONE);
  await visitAs(page, adminToken);
  await page.goto("/admin/settings/email");
  const bar = page.getByRole("navigation", { name: "Sections", exact: true });
  const save = page.getByRole("group", { name: "Save this section" });
  await expect(bar).toBeVisible();
  const field = page.locator(".settings-content input:not([type=checkbox]):not([type=radio]), .settings-content textarea").first();
  await field.click();
  await field.press("End");
  await field.pressSequentially("x");
  await expect(bar).toBeHidden();
  await expect(save.getByRole("button", { name: "Save" })).toBeEnabled();
  const box = await save.boundingBox();
  expect(box!.height, "one line").toBeLessThanOrEqual(64);
  // Leaving the field brings the bar back.
  await page.locator("h1").click();
  await expect(bar).toBeVisible();
  // Nothing is saved: discard.
  await save.getByRole("button", { name: "Discard changes" }).click();
});
