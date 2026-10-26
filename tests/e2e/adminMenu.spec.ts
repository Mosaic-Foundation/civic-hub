/**
 * The admin menu slice (2026-10-13), at phone width and on a desktop.
 *
 * 1. The Admin pill's menu (Reviews with its count, Moderation, Hub settings,
 *    Plugins, and since feedback routing Contact Civic.Social), the review icon, the personal account menu, "Processes";
 *    since the navigation slice the pill is the desktop Top tabs' only, and More and the sidebar hold the Admin group.
 * 2. Anchors open the right tab, section or plugin panel; panels start closed.
 * 3. The "?" beside a setting opens its note with the docs link.
 * 4. One sample deleted; "Remove samples" goes with the last; Next steps.
 * 5. The starter word cloud in the strip once the sample one goes; the
 *    picker's empty state.
 *
 * One demo hub with samples, made through the console's Create hub, visited on
 * its own address (<slug>.localhost on the UI's port), and archived after.
 * Needs the console's env on the API (CIVIC_CONSOLE_HOSTNAME=console.localhost).
 */

import { test, expect, type Page } from "@playwright/test";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";
import { readFileSync } from "node:fs";

const helpRegistry = JSON.parse(readFileSync("src/shared/helpRegistry.json", "utf8")) as Record<
  string,
  { text: string; page: string; anchor: string; pending?: boolean }
>;

const UI = new URL(process.env.CIVIC_E2E_UI_ORIGIN?.trim() || "http://localhost:5173");
const run = Date.now().toString(36);
const SLUG = `menu-${run}`;
const HUB = `${UI.protocol}//${SLUG}.localhost${UI.port ? `:${UI.port}` : ""}`;
const ADMIN = `menu-admin-${run}@example.test`;
const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 860 };

let consoleCookie = "";
let adminToken = "";

async function signedIn(page: Page, token: string): Promise<void> {
  await page.addInitScript((t) => {
    localStorage.setItem("seen_intro_popup", "true");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
    sessionStorage.setItem("civic_preview", "1");
    localStorage.setItem("civic_auth_token", t);
  }, token);
}

async function sessionFor(email: string): Promise<string> {
  const token = await mintSession(SLUG, email);
  await localRest(`users?hub_id=eq.${SLUG}&email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ tos_version_accepted: CURRENT_LEGAL_VERSION }),
  });
  return token;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  consoleCookie = await mintConsoleSession();
  const res = await consoleCall("POST", "/control/hubs", {
    cookie: consoleCookie,
    body: {
      slug: SLUG,
      hostname: `${SLUG}.localhost`,
      admin_email: ADMIN,
      name: "Menu Test Civic Hub",
      jurisdiction_name: "Example County, Ohio",
      jurisdiction_custom: true,
      jurisdiction_type: "county",
      sample_content: true,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  adminToken = await sessionFor(ADMIN);
});

test.afterAll(async () => {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantCode("step_up", code);
  await consoleCall("POST", `/control/hubs/${SLUG}/archive`, { cookie: consoleCookie, body: { step_up_code: code } });
});

async function reviewCount(page: Page): Promise<number> {
  const counts = await (
    await page.request.get(`${HUB}/api/admin/queue-counts`, { headers: { Authorization: `Bearer ${adminToken}` } })
  ).json();
  return counts.reviews + counts.briefs + counts.meeting_summaries;
}

const ADMIN_ITEMS = ["Reviews", "Moderation", "Hub settings", "Plugins", "Contact Civic.Social"];

// Since the navigation slice (2026-10-14) the Admin pill and the review icon
// are in the header only on a desktop with Top tabs; a phone has More's Admin
// group, and a desktop with the sidebar (a new hub's default) the sidebar's.
test("1. the Admin menu and the review icon (desktop, Top tabs)", async ({ page }) => {
  await page.request.put(`${HUB}/api/admin/hub/settings`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { section: "theme", values: { "nav.layout": "top_tabs" } },
  });
  try {
    await page.setViewportSize(DESKTOP);
    await signedIn(page, adminToken);
    const reviews = await reviewCount(page);

    await page.goto(`${HUB}/`);
    const icon = page.getByTestId("admin-review-icon");
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute("aria-label", reviews > 0 ? `Reviews: ${reviews} new` : "Reviews: nothing new");

    await page.getByRole("button", { name: "Admin", exact: true }).click();
    const menu = page.getByRole("menu", { name: "Admin" });
    const items = menu.getByRole("menuitem");
    await expect(items).toHaveText(reviews > 0 ? [`Reviews${reviews}`, ...ADMIN_ITEMS.slice(1)] : ADMIN_ITEMS);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // The account menu is personal.
    await page.getByRole("button", { name: `Account menu for ${ADMIN}` }).click();
    const account = page.getByRole("menu", { name: "Account menu" });
    await expect(account.getByRole("menuitem", { name: "My submissions" })).toBeVisible();
    await expect(account.getByRole("menuitem", { name: "Your settings" })).toBeVisible();
    await expect(account.getByRole("menuitem", { name: /Admin panel/ })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await menu.getByRole("menuitem", { name: "Plugins" }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/plugins$/);
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await menu.getByRole("menuitem", { name: /^Reviews/ }).click();
    await expect(page).toHaveURL(/\/admin\/(reviews|briefs|meeting-summaries)$/);
    await expect(page.getByRole("navigation", { name: "Admin sections" }).getByRole("link", { name: /^Processes/ })).toBeVisible();
  } finally {
    await page.request.put(`${HUB}/api/admin/hub/settings`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { section: "theme", values: { "nav.layout": "sidebar" } },
    });
  }
});

test("1. the Admin group in More (phone) and in the sidebar (desktop), Reviews with the same count", async ({ page }) => {
  await signedIn(page, adminToken);
  const reviews = await reviewCount(page);

  await page.setViewportSize(PHONE);
  await page.goto(`${HUB}/`);
  await expect(page.getByTestId("admin-review-icon")).toBeHidden();
  await page.getByRole("navigation", { name: "Sections", exact: true }).locator('[data-nav-id="more"]').click();
  const sheet = page.getByTestId("more-sheet");
  for (const label of ADMIN_ITEMS) await expect(sheet.locator(".nav-item", { hasText: label })).toBeVisible();
  if (reviews > 0) await expect(sheet.locator('[data-nav-id="reviews"] .nav-item-count')).toHaveText(String(reviews));
  await sheet.getByRole("link", { name: "Plugins" }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/plugins$/);

  // A new hub is created with the sidebar.
  await page.setViewportSize(DESKTOP);
  await page.goto(`${HUB}/`);
  const side = page.getByRole("navigation", { name: "Hub", exact: true });
  await expect(side).toBeVisible();
  for (const label of ADMIN_ITEMS) await expect(side.locator(".nav-item", { hasText: label })).toBeVisible();
  await side.locator('[data-nav-id="reviews"]').click();
  await expect(page).toHaveURL(/\/admin\/(reviews|briefs|meeting-summaries)$/);
  await expect(side.locator('[data-nav-id="reviews"]')).toHaveAttribute("aria-current", "page");
});

test("1. a resident has no Admin pill, no review icon and no Admin group", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signedIn(page, await sessionFor(`menu-resident-${run}@example.test`));
  await page.goto(`${HUB}/`);
  await expect(page.getByRole("button", { name: /^Account menu/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Admin", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("admin-review-icon")).toHaveCount(0);
  await page.getByRole("navigation", { name: "Sections", exact: true }).locator('[data-nav-id="more"]').click();
  await expect(page.getByTestId("more-sheet").locator('[data-nav-id="reviews"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.setViewportSize(DESKTOP);
  await expect(page.getByRole("navigation", { name: "Hub", exact: true }).locator('[data-nav-id="reviews"]')).toHaveCount(0);
});

test("2. anchors open the right tab, section or plugin panel; panels start closed", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signedIn(page, adminToken);
  await page.goto(`${HUB}/admin#moderation`);
  await expect(page).toHaveURL(/\/admin\/moderation$/);

  await page.goto(`${HUB}/admin/settings#feedback`);
  await expect(page).toHaveURL(/\/admin\/settings\/plugins#feedback$/);
  const feedback = page.getByRole("region", { name: "Feedback", exact: true });
  await expect(feedback.getByRole("button", { name: /^Feedback/ })).toHaveAttribute("aria-expanded", "true");
  await expect(feedback).toBeInViewport();
  // Every other panel is closed until clicked.
  const votes = page.getByRole("region", { name: "Votes", exact: true });
  const head = votes.getByRole("button", { name: /^Votes/ });
  await expect(head).toHaveAttribute("aria-expanded", "false");
  // A package's plugin shows Install / Remove in its panel (ADR-014).
  await expect(votes.getByTestId("plugin-install-vote")).toHaveCount(0);
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  await expect(votes.getByTestId("plugin-install-vote")).toBeVisible();

  await page.goto(`${HUB}/admin/settings#threshold`);
  await expect(page).toHaveURL(/\/admin\/settings\/participation#threshold$/);
  await expect(page.locator("#threshold")).toBeInViewport();
});

for (const [name, viewport] of [["phone", PHONE], ["desktop", DESKTOP]] as const) {
  test(`3. a "?" opens its note with the docs link (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signedIn(page, adminToken);
    await page.goto(`${HUB}/admin/settings/identity`);
    const entry = helpRegistry["identity.name"];
    const help = page.getByRole("button", { name: "About Hub name" });
    await help.click();
    const note = page.getByRole("note");
    await expect(note).toContainText(entry.text);
    await expect(note.getByRole("link", { name: "More in the docs" })).toHaveAttribute(
      "href",
      `https://docs.civic.social${entry.page}#${entry.anchor}`,
    );
    const box = (await note.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    await page.keyboard.press("Escape");
    await expect(note).toBeHidden();
    await expect(help).toBeFocused();

    // A section's "?", and a plugin panel's, which never opens the panel.
    await expect(page.getByRole("button", { name: "About Identity" })).toBeVisible();
    await page.goto(`${HUB}/admin/settings/plugins`);
    const search = page.getByRole("region", { name: "Search", exact: true });
    await search.getByRole("button", { name: "About Search" }).click();
    await expect(page.getByRole("note")).toBeVisible();
    await expect(search.getByRole("button", { name: /^Search/ })).toHaveAttribute("aria-expanded", "false");
  });
}

test("4 and 5. delete one sample; the starter takes the word cloud's place; the last sample brings Next steps", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signedIn(page, adminToken);
  const auth = { Authorization: `Bearer ${adminToken}` };

  const first = await (await page.request.get(`${HUB}/api/admin/hub/sample-content`, { headers: auth })).json();
  const cloudTitle = (first.items as Array<{ type: string; title: string }>).find((i) => i.type === "civic.wordcloud")!.title;
  await page.goto(`${HUB}/admin/settings/sample`);
  const list = page.getByRole("list", { name: "Samples" });
  await expect(list.getByRole("link", { name: cloudTitle })).toBeVisible();
  await expect(page.getByRole("region", { name: "Demo notice" }).getByRole("link", { name: "Remove samples" })).toBeVisible();

  // One sample, through its own button and one confirmation.
  await list.getByRole("button", { name: `Delete sample: ${cloudTitle}` }).click();
  const dialog = page.getByRole("dialog", { name: "Delete this sample?" });
  await expect(dialog).toContainText(cloudTitle);
  await dialog.getByRole("button", { name: "Delete sample" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: `Deleted “${cloudTitle}”.` })).toBeVisible();
  await expect(list.getByRole("link", { name: cloudTitle })).toHaveCount(0);

  // The strip now leads to the starter word cloud: real content, no place
  // named. The strip says only its label; the prompt is on the cloud's page
  // (Adam, 2026-10-14).
  await page.goto(`${HUB}/`);
  await page.getByRole("link", { name: "View the community word cloud" }).click();
  await expect(page.getByText("In one word, what matters most to you about this community?")).toBeVisible();

  // A sample's own page offers Delete sample beside Archive.
  const summary = await (await page.request.get(`${HUB}/api/admin/hub/sample-content`, { headers: auth })).json();
  const proposal = (summary.items as Array<{ id: string; type: string; path: string; title: string }>).find(
    (i) => i.type === "civic.proposal",
  )!;
  await page.goto(`${HUB}${proposal.path}`);
  await page.getByRole("button", { name: "Delete sample", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete this sample?" }).getByRole("button", { name: "Delete sample" }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/sample$/);
  await expect(page.getByRole("link", { name: proposal.title })).toHaveCount(0);

  // The rest through the API, then the last through the page.
  const left = ((await (await page.request.get(`${HUB}/api/admin/hub/sample-content`, { headers: auth })).json()).items as Array<{ id: string; title: string }>);
  for (const item of left.slice(1)) {
    const res = await page.request.delete(`${HUB}/api/admin/hub/sample-content/${item.id}`, { headers: auth });
    expect(res.ok()).toBeTruthy();
  }
  await page.goto(`${HUB}/admin/settings/sample`);
  await page.getByRole("button", { name: `Delete sample: ${left[0].title}` }).click();
  await page.getByRole("dialog", { name: "Delete this sample?" }).getByRole("button", { name: "Delete sample" }).click();
  const next = page.getByRole("region", { name: "Next: set up your hub" });
  await expect(next).toBeVisible();
  // Its steps since the leaving-demo slice (2026-10-15): every readiness item, ending at Mode.
  await expect(next.getByRole("link", { name: "Name it, add a banner and set its time zone" })).toHaveAttribute("href", "/admin/settings/identity");
  await expect(next.getByRole("link", { name: "Give a postal address for the hub's email" })).toHaveAttribute("href", "/admin/settings/email");
  await expect(next.getByRole("link", { name: "Switch to beta" })).toHaveAttribute("href", "/admin/settings/mode");
  // The demo bar stays (the hub is still a demo) without "Remove samples".
  const bar = page.getByRole("region", { name: "Demo notice" });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link", { name: "Remove samples" })).toHaveCount(0);
});

test("5. with no word cloud, the picker says so and links to making one", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signedIn(page, adminToken);
  // None chosen, and nothing to choose: the hub's list answers empty.
  const res = await page.request.put(`${HUB}/api/admin/hub/settings`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { section: "plugins", values: { "plugin.wordcloud.onboarding_id": "" } },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  await page.route(/\/api\/process\?type=civic\.wordcloud/, (route) => route.fulfill({ json: [] }));
  await page.goto(`${HUB}/admin/settings/plugins#wordcloud`);
  const card = page.getByRole("region", { name: "Word clouds", exact: true });
  await expect(card.getByRole("status")).toHaveText(/This hub has no word cloud yet/);
  await expect(card.getByRole("combobox")).toHaveCount(0);
  await card.getByRole("link", { name: "Create a word cloud" }).click();
  await expect(page).toHaveURL(/\/wordcloud\/new$/);
});
