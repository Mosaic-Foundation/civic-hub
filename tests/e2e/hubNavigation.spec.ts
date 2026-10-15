/**
 * The navigation slice (2026-10-14), at phone width and on a desktop.
 *
 * 1. Feed items carry their type's pill (the registry's label) in the meta
 *    line, and the title keeps the full width.
 * 2. The sections come from the registry and the hub's one Section order:
 *    switching a plugin off removes its section from the bar's chooser (Hub
 *    settings → Theme → Section order), the More sheet and the sidebar.
 * 3. Phones: the bottom bar (Feed, Discuss, Proposals, Votes, More) under either
 *    Navigation setting; More's sheet lists every section, Admin for admins
 *    only and You; it closes on Escape (focus back on More), a tap outside and
 *    a swipe down. A drafting form hides the bar, typing included.
 * 4. Desktop with Sidebar: the sidebar instead of the header and the tabs,
 *    with counts, "Signed in as", and the current page marked.
 * 5. Hub settings → Theme: unset Navigation is Top tabs; Sidebar and a new
 *    order take effect at once, and the first four of the order are the bar.
 * 6. Polish (2026-10-14): a section page opens at its own header with no
 *    masthead, which is on Feed and About; the mode notice closes to a thin
 *    bar and stays so on reload; More opens and closes from the bar; the
 *    sheet's first group is the hub's name; "Discuss" on the bar,
 *    "Conversations" in the sheet.
 *
 * Acts on whichever hub `localhost` resolves to (CIVIC_DEV_HUB; Athens on the
 * local stack with CI's env) as its admin and as a resident, with sessions
 * written into the LOCAL stack. Every setting it changes is put back.
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { localRest, storedSetting } from "../fixtures/adminSession.js";
import { adminEmailFor, hubId, liveVote, closeAsAdmin, run, session, visitAs } from "./actors";
import { E2E_API_BASE as API } from "./hubApi";

const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 900 };
const KEYS = ["nav.layout", "nav.section_order", "plugin.conversation.enabled"];

let hub = "";
let adminToken = "";
let residentToken = "";
let voteId = "";
const voteTitle = `Nav pill ${run}`;
let restore: Array<[string, string | undefined]> = [];

async function put(request: APIRequestContext, section: string, values: Record<string, string>) {
  const res = await request.put(`${API}/admin/hub/settings`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { section, values },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

const bar = (page: Page) => page.getByRole("navigation", { name: "Sections", exact: true });
const sheet = (page: Page) => page.getByTestId("more-sheet");
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Hub", exact: true });

async function openMore(page: Page) {
  await bar(page).locator('[data-nav-id="more"]').click();
  await expect(sheet(page)).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  hub = await hubId(request);
  adminToken = (await session(hub, adminEmailFor(hub))).token;
  const resident = `nav-resident-${run}@example.test`;
  residentToken = (await session(hub, resident)).token;
  await localRest(`users?hub_id=eq.${hub}&email=eq.${encodeURIComponent(resident)}`, {
    method: "PATCH",
    body: JSON.stringify({ is_resident: true, full_name: "Nav Resident" }),
  });
  restore = await Promise.all(KEYS.map(async (k) => [k, await storedSetting(hub, k)] as [string, string | undefined]));
  voteId = await liveVote(request, adminToken, voteTitle);
});

// Put back through the API, never by writing the table: the API caches a
// hub's settings, and only its own save clears that, so a row deleted behind
// its back left the next spec looking at the sidebar. An empty value reads as
// unset; a plugin's switch has no unset, and on is its default.
test.afterAll(async ({ request }) => {
  if (voteId) await closeAsAdmin(request, adminToken, voteId);
  for (const [k, v] of restore) {
    const plugin = k.startsWith("plugin.");
    await put(request, plugin ? "plugins" : "theme", { [k]: v ?? (plugin ? "true" : "") });
  }
});

test("a feed item's type is a pill in its meta line, from the registry", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await visitAs(page, residentToken);
  await page.goto("/");
  const card = page.locator("article.feed-post", { hasText: voteTitle });
  await expect(card).toBeVisible();
  const pill = card.getByTestId("feed-type-pill");
  await expect(pill).toHaveText("Vote");
  // The pill leads the meta line, under the title, which keeps the width.
  await expect(card.locator(".feed-post-meta").getByTestId("feed-type-pill")).toHaveCount(1);
  const title = await card.locator(".feed-post-title").boundingBox();
  const body = await card.locator(".feed-post-body").boundingBox();
  expect(title!.width).toBeGreaterThan(body!.width - 2);
});

test("phones: the bar's five tabs, the current one marked, kept on a vote's page", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await visitAs(page, residentToken);
  await page.goto("/");
  const tabs = bar(page).locator(".bottom-bar-label");
  await expect(tabs).toHaveText(["Feed", "Discuss", "Proposals", "Votes", "More"]);
  await expect(bar(page).locator('[aria-current="page"]')).toHaveText("Feed");
  // The old strip and the drawer's button are gone at phone width.
  await expect(page.locator(".feed-votes-tabs")).toBeHidden();
  await expect(page.locator(".civic-nav-hamburger")).toBeHidden();

  await bar(page).getByRole("link", { name: "Votes" }).click();
  await expect(page).toHaveURL(/\/votes$/);
  await expect(bar(page).locator('[aria-current="page"]')).toHaveText("Votes");
  // A vote's own page belongs to Votes, and keeps the bar.
  await page.goto(`/process/${voteId}`);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator('[aria-current="page"]')).toHaveText("Votes");
});

test("phones: More lists every section and You, no Admin for a resident, and closes on Escape", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await visitAs(page, residentToken);
  await page.goto("/");
  await openMore(page);
  const s = sheet(page);
  for (const label of ["Feed", "Conversations", "Proposals", "Votes", "Projects", "Outcomes", "Feedback", "About"]) {
    await expect(s.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  // Read with its count: "Members 7,925".
  await expect(s.getByRole("link", { name: /^Members \d/ })).toBeVisible();
  await expect(s.getByRole("button", { name: "Share this hub" })).toBeVisible();
  await expect(s.getByText("Admin", { exact: true })).toHaveCount(0);
  await expect(s.getByRole("link", { name: "Hub settings" })).toHaveCount(0);
  await expect(s.getByText("Signed in as Nav Resident")).toBeVisible();
  await expect(s.getByRole("link", { name: "Your settings" })).toBeVisible();
  // Focus is inside the sheet (on its ×), and goes back to More when it closes.
  await expect(s.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
  await expect(bar(page).locator('[data-nav-id="more"]')).toBeFocused();
});

test("phones: More closes on a tap outside and on a swipe down", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await visitAs(page, residentToken);
  await page.goto("/");
  await openMore(page);
  // The backdrop: the dialog's own box, above the sheet's panel.
  await page.mouse.click(PHONE.width / 2, 20);
  await expect(sheet(page)).toBeHidden();

  await openMore(page);
  await sheet(page).evaluate((el) => {
    const touch = (y: number) => new Touch({ identifier: 1, target: el, clientX: 180, clientY: y });
    el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [touch(300)] }));
    el.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, touches: [touch(420)] }));
    el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [] }));
  });
  await expect(sheet(page)).toBeHidden();
});

test("phones: an admin's More has the Admin group with Reviews", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await visitAs(page, adminToken);
  await page.goto("/");
  // The Admin pill and review icon leave the phone's header for More.
  await expect(page.locator(".civic-nav .admin-pill")).toBeHidden();
  await openMore(page);
  const s = sheet(page);
  await expect(s.getByText("Admin", { exact: true })).toBeVisible();
  for (const label of ["Reviews", "Moderation", "Hub settings", "Plugins", "Contact Civic.Social"]) {
    await expect(s.locator(".nav-item", { hasText: label })).toBeVisible();
  }
  await s.getByRole("link", { name: "Hub settings" }).click();
  await expect(page).toHaveURL(/\/admin\/settings/);
  await expect(page.getByRole("heading", { name: "Hub settings", level: 1 })).toBeVisible();
});

test("phones: a drafting form hides the bar, before and while typing", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await visitAs(page, residentToken);
  await page.goto("/propose/new");
  const title = page.getByLabel(/title/i).first();
  await expect(title).toBeVisible();
  await expect(bar(page)).toBeHidden();
  await title.click();
  await page.keyboard.type("Typing on a phone");
  await expect(bar(page)).toBeHidden();
});

test("desktop: unset Navigation is Top tabs, as before the slice", async ({ page, request }) => {
  await put(request, "theme", { "nav.layout": "" });
  await page.setViewportSize(DESKTOP);
  await visitAs(page, residentToken);
  await page.goto("/");
  await expect(page.locator(".feed-votes-tabs")).toBeVisible();
  await expect(page.locator(".civic-nav")).toBeVisible();
  await expect(sidebar(page)).toHaveCount(0);
  await expect(bar(page)).toBeHidden();
  expect((await (await request.get(`${API}/hub-config`)).json()).settings["nav.layout"]).toBeUndefined();
});

test("Hub settings → Theme: Sidebar and a new order take effect at once, everywhere", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await visitAs(page, adminToken);
  await page.goto("/admin/settings/theme");
  await page.getByRole("radio", { name: /Sidebar/ }).check();
  // Votes up twice: Feed, Votes, Conversations, Proposals…
  const order = page.locator(".nav-order");
  await order.getByRole("button", { name: "Move Votes up" }).click();
  await expect(order.getByRole("button", { name: "Move Votes up" })).toBeFocused();
  await order.getByRole("button", { name: "Move Votes up" }).click();
  await expect(order.locator(".nav-order-row .nav-order-label")).toContainText([
    "Feed",
    "Votes",
    "Conversations",
    "Proposals",
  ]);
  await expect(page.locator(".nav-order-preview")).toContainText("Feed · Votes · Discuss · Proposals · More");
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByText(/^Saved\./)).toBeVisible();

  // The sidebar, at once: header and tabs gone, the order applied, Hub settings current.
  await expect(sidebar(page)).toBeVisible();
  await expect(page.locator(".civic-nav")).toBeHidden();
  await expect(page.locator(".feed-votes-tabs")).toBeHidden();
  const sections = sidebar(page).getByRole("list", { name: "Sections" }).locator(".nav-item-label");
  await expect(sections).toHaveText(["Feed", "Votes", "Conversations", "Proposals", "Projects", "Outcomes", "Members"]);
  await expect(sidebar(page).locator('[aria-current="page"]')).toContainText("Hub settings");
  await expect(sidebar(page).getByText("Admin", { exact: true })).toBeVisible();
  await expect(sidebar(page).locator('[data-nav-id="reviews"]')).toBeVisible();
  await expect(sidebar(page).getByText(/Signed in as/)).toBeVisible();

  // The phone's bar follows the same order.
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await expect(bar(page).locator(".bottom-bar-label")).toHaveText(["Feed", "Votes", "Discuss", "Proposals", "More"]);
});

test("desktop: a resident's sidebar has no Admin group, counts beside Members, the current page marked", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await visitAs(page, residentToken);
  await page.goto("/propose");
  await expect(sidebar(page)).toBeVisible();
  await expect(sidebar(page).getByText("Admin", { exact: true })).toHaveCount(0);
  await expect(sidebar(page).locator('[data-nav-id="hub-settings"]')).toHaveCount(0);
  await expect(sidebar(page).locator('[aria-current="page"]')).toContainText("Proposals");
  await expect(sidebar(page).locator('[data-nav-id="members"] .nav-item-count')).toBeVisible();
  await expect(sidebar(page).getByText("Signed in as Nav Resident")).toBeVisible();
  await expect(sidebar(page).getByRole("link", { name: "Feedback" })).toBeVisible();
});

test("a plugin switched off leaves the chooser, the sheet and the sidebar", async ({ page, request }) => {
  await put(request, "plugins", { "plugin.conversation.enabled": "false" });
  await page.setViewportSize(DESKTOP);
  await visitAs(page, adminToken);
  await page.goto("/admin/settings/theme");
  await expect(page.locator(".nav-order")).not.toContainText("Conversations");
  await expect(sidebar(page).getByRole("list", { name: "Sections" })).not.toContainText("Conversations");

  await page.setViewportSize(PHONE);
  await page.goto("/");
  // Conversations was second in the order; Proposals and Projects move up.
  await expect(bar(page).locator(".bottom-bar-label")).toHaveText(["Feed", "Votes", "Proposals", "Projects", "More"]);
  await openMore(page);
  await expect(sheet(page).getByRole("link", { name: "Conversations" })).toHaveCount(0);

  // Back on, it is a newly enabled section: at the end of the order.
  await put(request, "plugins", { "plugin.conversation.enabled": "true" });
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await expect(sidebar(page).getByRole("list", { name: "Sections" }).locator(".nav-item-label")).toHaveText([
    "Feed",
    "Votes",
    "Proposals",
    "Projects",
    "Outcomes",
    "Members",
    "Conversations",
  ]);
});

test("a section page opens at its own header, with no masthead; Feed and About have it", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await visitAs(page, residentToken);
  await page.goto("/propose");
  const title = page.getByRole("heading", { name: "Community Proposals", level: 1 });
  await expect(title).toBeVisible();
  await expect(page.locator(".hub-info")).toHaveCount(0);
  await expect(page.locator(".hub-banner")).toHaveCount(0);
  // The header and the first item are on the first screen, with no scrolling.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const first = page.locator(".process-list-card, article").first();
  if ((await first.count()) > 0) expect((await first.boundingBox())!.y).toBeLessThan(PHONE.height - 70);

  for (const path of ["/", "/about"]) {
    await page.goto(path);
    await expect(page.locator(".hub-info")).toBeVisible();
  }
});

test("the mode notice closes to a thin bar, and stays thin on reload", async ({ page, request }) => {
  const mode = (await (await request.get(`${API}/hub-config`)).json()).hub.mode as string;
  test.skip(mode === "live", "a live hub has no mode notice");
  await page.setViewportSize(PHONE);
  await visitAs(page, residentToken);
  await page.goto("/");
  const notice = page.getByTestId("mode-notice");
  await expect(notice).toHaveAttribute("data-state", "full");
  await notice.getByRole("button", { name: /^Close the/ }).click();
  await expect(notice).toHaveAttribute("data-state", "thin");
  const short = mode === "beta" ? "Beta hub" : "Demo hub";
  await expect(notice.getByRole("button", { name: new RegExp(`^${short}`) })).toBeFocused();
  await page.reload();
  await expect(page.getByTestId("mode-notice")).toHaveAttribute("data-state", "thin");
  // The short label opens the full message again.
  await page.getByTestId("mode-notice").getByRole("button", { name: new RegExp(`^${short}`) }).click();
  await expect(page.getByTestId("mode-notice")).toHaveAttribute("data-state", "full");
});

test("More opens and closes from the bar; the sheet's first group is the hub's name; Discuss on the bar", async ({ page, request }) => {
  const config = await (await request.get(`${API}/hub-config`)).json();
  const name = (config.settings["identity.name"] ?? config.hub.name) as string;
  // The default order (an earlier test moved Conversations to the end).
  await put(request, "theme", { "nav.section_order": "" });
  await page.setViewportSize(PHONE);
  await visitAs(page, residentToken);
  await page.goto("/");
  await expect(bar(page).getByRole("link", { name: "Discuss" })).toBeVisible();
  await openMore(page);
  const s = sheet(page);
  await expect(s.getByRole("heading", { name })).toBeVisible();
  await expect(s.getByRole("list", { name })).toContainText("Conversations");
  await expect(s.getByText("Discuss")).toHaveCount(0);
  // The bar under the sheet: More is current, expanded, a ×, and closes it.
  const more = page.getByTestId("more-sheet-bar").locator('[data-nav-id="more"]');
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(more).toHaveClass(/is-current/);
  await more.click();
  await expect(sheet(page)).toBeHidden();
  await expect(bar(page).locator('[data-nav-id="more"]')).toHaveAttribute("aria-expanded", "false");
  // The × beside the hub's name closes it too.
  await openMore(page);
  await sheet(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet(page)).toBeHidden();
});
