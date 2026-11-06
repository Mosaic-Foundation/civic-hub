/**
 * The admin rail (pilot readiness 3, Adam 2026-11-06).
 *
 * 5. Admin always uses the left rail, whatever the public layout: the hub
 *    header stays, "Back to the hub" and "Admin" head the rail, the public
 *    section tabs are hidden, and there is no admin bar. A phone keeps its
 *    bottom bar and opens the rail as a drawer from the Admin button.
 * 6. The rail never scrolls: Review, Community, Activity, Hub settings (its
 *    sections open under it only while you're in it) and the small foot fit
 *    a window 768px tall with every plugin on and Hub settings open.
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
    await expect(rail(page).getByRole("heading", { level: 3 })).toHaveText([/^Review/, /^Community/]);
    await expect(rail(page).locator('[data-nav-id="processes"]')).toHaveAttribute("aria-current", "page");
    // Hub settings' sections are not open outside it.
    await expect(rail(page).getByRole("navigation", { name: "Hub settings sections" })).toHaveCount(0);

    // Back to the hub: the public layout returns.
    await rail(page).getByRole("link", { name: "Back to the hub" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(rail(page)).toHaveCount(0);
    if (layout === "top_tabs") await expect(page.locator(".feed-votes-tabs")).toBeVisible();
  });
}

test("the rail fits a window 768px tall without scrolling, Hub settings open", async ({ page, request }) => {
  await setLayout(request, "top_tabs");
  // Every plugin that adds an admin item on, so the rail is as long as it gets.
  const plugins = ["brief", "meeting_summary", "feedback", "analytics"].map((p) => `plugin.${p}.enabled`);
  const before = await Promise.all(plugins.map((k) => storedSetting(hub, k)));
  const putPlugins = (values: Record<string, string>) =>
    request.put(`${API}/admin/hub/settings`, { headers: { Authorization: `Bearer ${adminToken}` }, data: { section: "plugins", values } });
  expect((await putPlugins(Object.fromEntries(plugins.map((k) => [k, "true"])))).ok()).toBeTruthy();
  try {
  await page.setViewportSize(SHORT);
  await visitAs(page, adminToken);
  await page.goto("/admin/settings/identity");
  const sections = rail(page).getByRole("navigation", { name: "Hub settings sections" });
  await expect(sections).toBeVisible();
  await expect(sections.getByRole("link", { name: "Identity" })).toHaveAttribute("aria-current", "page");
  // Every group, item and foot link is drawn (the hub has every admin plugin on).
  for (const id of ["processes", "briefs", "meeting-summaries", "edits", "admin-feedback", "analytics", "moderation", "hub-settings", "archived", "setup-guide", "contact"]) {
    await expect(rail(page).locator(`[data-nav-id="${id}"]`)).toBeVisible();
  }
  const fit = await page.locator(".hub-sidebar").evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(fit.scroll, `rail content ${fit.scroll}px in ${fit.client}px`).toBeLessThanOrEqual(fit.client);
  // The foot's last link is inside the window.
  const contact = await rail(page).locator('[data-nav-id="contact"]').boundingBox();
  expect(contact!.y + contact!.height).toBeLessThanOrEqual(SHORT.height);
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
