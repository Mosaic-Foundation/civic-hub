/**
 * Three columns (layout session, Adam 2026-11-07; ADR-019).
 *
 * 6. Hub settings → Appearance → Navigation offers Top navigation, Left
 *    column and Three columns (the stored values unchanged).
 * 7. From 1280px: the left column a card, flush left; the feed between even
 *    48px gaps; the right column's cards flush right. A masthead (bars, the
 *    word cloud teaser, the banner photo) spans the window above the columns
 *    (Adam, after dev). Left column is the same page without the right column.
 * 8. The cards: Coming up (events and closing dates, date first), the latest
 *    announcements, About. A card with nothing to show is not drawn.
 * 9. Appearance → Right column: each card switched on or off, put in order by
 *    dragging or by Up and Down, saved as one setting.
 * 10. Below 1280px the right column goes, on every page; a phone is the
 *    phone's layout. Section pages have the column; About, sign-in, search
 *    and your settings don't.
 *
 * Acts on whichever hub `localhost` resolves to (Athens on the local stack
 * with CI's env), as its admin. The layout and the cards are put back
 * through the API afterwards; the vote it opens is left, as other specs'
 * are.
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { storedSetting } from "../fixtures/adminSession.js";
import { adminEmailFor, hubId, liveVote, run, session, visitAs } from "./actors";
import { E2E_API_BASE as API } from "./hubApi";

const WIDE = { width: 1440, height: 900 };
const MIDDLE = { width: 1100, height: 900 };
const PHONE = { width: 375, height: 812 };

let hub = "";
let adminToken = "";
let before: { layout?: string; cards?: string } = {};
const voteTitle = `Three columns vote ${run}`;

async function setTheme(request: APIRequestContext, values: Record<string, string>) {
  const res = await request.put(`${API}/admin/hub/settings`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { section: "theme", values },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

const aside = (page: Page) => page.getByRole("complementary", { name: "More from this hub" });
/** The cards drawn, in order, once the column has its data (it is aria-busy until then). */
async function cardIds(page: Page): Promise<Array<string | null>> {
  await expect(aside(page)).not.toHaveAttribute("aria-busy", "true");
  return aside(page).locator("[data-aside-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-aside-card")));
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  hub = await hubId(request);
  adminToken = (await session(hub, adminEmailFor(hub))).token;
  before = { layout: await storedSetting(hub, "nav.layout"), cards: await storedSetting(hub, "nav.aside_cards") };
  // Something closing within the fortnight: Coming up always has a row.
  await liveVote(request, adminToken, voteTitle);
});

test.afterAll(async ({ request }) => {
  await setTheme(request, { "nav.layout": before.layout ?? "", "nav.aside_cards": before.cards ?? "" });
});

test("three columns at full width: a card on the left, the feed centred, the cards on the right", async ({ page, request }) => {
  await setTheme(request, { "nav.layout": "three_columns", "nav.aside_cards": "" });
  await page.setViewportSize(WIDE);
  await visitAs(page, adminToken);
  await page.goto("/");
  await expect(aside(page)).toBeVisible();
  // Coming up: dated rows, earliest first, five at most. The vote this spec
  // opened closes within the fortnight, so the card has a row; earlier runs'
  // votes may close sooner and fill it, so the row is any "… closes" one.
  const coming = aside(page).getByRole("region", { name: "Coming up" });
  const rows = coming.getByRole("link");
  await expect(rows.first()).toContainText(/closes|Event/);
  await expect(rows.first().locator(".aside-date")).toBeVisible();
  expect(await rows.count()).toBeLessThanOrEqual(5);
  // About is always there; Announcements only when the hub has some.
  await expect(aside(page).getByRole("region", { name: /^About / })).toBeVisible();
  expect((await cardIds(page)).filter((id) => id !== "announcements")).toEqual(["coming_up", "about"]);

  // The left column is a rounded card, flush left; the cards flush right; the feed between.
  const sidebar = page.locator(".hub-sidebar");
  expect(await sidebar.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThan(0);
  const left = (await sidebar.boundingBox())!;
  const shell = (await page.locator(".page-shell").boundingBox())!;
  const firstCard = (await aside(page).locator("[data-aside-card]").first().boundingBox())!;
  expect(left.x).toBeLessThan(40);
  expect(WIDE.width - (firstCard.x + firstCard.width)).toBeLessThan(40);
  // The same gap either side of the feed: twice the card's margin (Adam, 2026-11-07).
  expect(Math.abs(shell.x - (left.x + left.width) - 48)).toBeLessThan(3);
  expect(Math.abs(firstCard.x - (shell.x + shell.width) - 48)).toBeLessThan(3);
  // The masthead spans the window above the columns; the card, the feed and the cards start level under it.
  await expectMasthead(page);
  // The cards stay in view as the feed scrolls.
  await page.mouse.wheel(0, 1500);
  await expect(coming).toBeInViewport();

  // A section page has the column; About, search and your settings don't.
  await page.goto("/votes");
  await expect(aside(page)).toBeVisible();
  await page.goto("/about");
  await expect(page.locator(".hub-sidebar")).toBeVisible();
  await expect(aside(page)).toHaveCount(0);
  await page.goto("/settings");
  await expect(aside(page)).toHaveCount(0);
  // Admin keeps its own layout.
  await page.goto("/admin/reviews");
  await expect(page.getByRole("navigation", { name: "Admin sections" })).toBeVisible();
  await expect(aside(page)).toHaveCount(0);
});

test("Left column is Three columns without the right column", async ({ page, request }) => {
  await setTheme(request, { "nav.layout": "sidebar", "nav.aside_cards": "" });
  await page.setViewportSize(WIDE);
  await visitAs(page, adminToken);
  await page.goto("/");
  await expect(page.locator(".feed").first()).toBeVisible();
  await expect(aside(page)).toHaveCount(0);
  const sidebar = page.locator(".hub-sidebar");
  expect(await sidebar.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThan(0);
  const left = (await sidebar.boundingBox())!;
  const shell = (await page.locator(".page-shell").boundingBox())!;
  expect(Math.abs(shell.x - (left.x + left.width) - 48)).toBeLessThan(3);
  expect(Math.abs(WIDE.width - (shell.x + shell.width) - 48)).toBeLessThan(3);
  await expectMasthead(page);
});

/** The masthead runs the window's width, and the columns start level under it. */
async function expectMasthead(page: Page) {
  const masthead = (await page.locator(".app-masthead").boundingBox())!;
  expect(masthead.x).toBe(0);
  expect(Math.abs(masthead.width - (page.viewportSize()!.width))).toBeLessThan(20);
  await expect(page.locator(".app-masthead .hub-banner")).toBeVisible();
  const card = (await page.locator(".hub-sidebar").boundingBox())!;
  const column = (await page.locator(".app-column").boundingBox())!;
  expect(card.y).toBeGreaterThanOrEqual(masthead.y + masthead.height);
  expect(Math.abs(card.y - (column.y + 24))).toBeLessThan(3);
}

test("narrower, the right column goes first; a phone is the phone's layout", async ({ page, request }) => {
  await setTheme(request, { "nav.layout": "three_columns", "nav.aside_cards": "" });
  await visitAs(page, adminToken);
  await page.setViewportSize(MIDDLE);
  await page.goto("/");
  await expect(page.locator(".hub-sidebar")).toBeVisible();
  await expect(page.locator(".feed").first()).toBeVisible();
  await expect(aside(page)).toHaveCount(0);
  await page.goto("/votes");
  await expect(aside(page)).toHaveCount(0);

  await page.setViewportSize(PHONE);
  await page.goto("/");
  await expect(page.locator(".bottom-bar")).toBeVisible();
  await expect(page.locator(".hub-sidebar")).toBeHidden();
  await expect(aside(page)).toHaveCount(0);
});

test("an admin picks Three columns and sets the right column's cards", async ({ page, request }) => {
  await setTheme(request, { "nav.layout": "top_tabs", "nav.aside_cards": "" });
  await page.setViewportSize(WIDE);
  await visitAs(page, adminToken);
  await page.goto("/admin/settings/theme");
  const choices = page.locator("#nav-layout .settings-mode-title");
  await expect(choices).toHaveText(["Top navigation", "Left column", "Three columns"]);
  // The Right column appears with the choice.
  await expect(page.locator("#nav-aside-cards")).toHaveCount(0);
  await page.locator("#nav-layout").getByText("Three columns").click();
  const list = page.getByRole("list", { name: "Right column cards" });
  await expect(list.locator(".kit-sortable-name")).toHaveText(["Coming up", "Announcements", "About"]);

  // Up and Down from the keyboard; the button keeps focus.
  const aboutUp = page.getByRole("button", { name: "Move About up" });
  await aboutUp.click();
  await expect(aboutUp).toBeFocused();
  await expect(list.locator(".kit-sortable-name")).toHaveText(["Coming up", "About", "Announcements"]);
  // Dragged by its handle with the pointer.
  const handle = list.locator('[data-id="about"] .kit-sortable-handle');
  const target = (await list.locator('[data-id="coming_up"]').boundingBox())!;
  const from = (await handle.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, target.y + 4, { steps: 8 });
  await page.mouse.up();
  await expect(list.locator(".kit-sortable-name")).toHaveText(["About", "Coming up", "Announcements"]);
  // Announcements off.
  const show = page.getByRole("switch", { name: "Show Announcements" });
  await expect(show).toBeChecked();
  await show.uncheck();
  await expect(show).not.toBeChecked();

  await page.getByRole("group", { name: "Save this section" }).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  expect(await storedSetting(hub, "nav.layout")).toBe("three_columns");
  expect(JSON.parse((await storedSetting(hub, "nav.aside_cards")) ?? "[]")).toEqual([
    { id: "about", shown: true },
    { id: "coming_up", shown: true },
    { id: "announcements", shown: false },
  ]);

  // The hub draws them so.
  await page.goto("/");
  await expect(aside(page)).toBeVisible();
  expect(await cardIds(page)).toEqual(["about", "coming_up"]);
});
