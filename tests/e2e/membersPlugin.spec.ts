/**
 * The Members plugin (2026-10-14, Adam), on the hub `localhost` resolves to
 * (Athens on the local stack: thousands of members), as its admin and as a
 * resident. Every setting it changes is put back through the API (the API
 * caches settings; tests/TESTING.md).
 *
 * 1. Hub settings → Plugins → Members: an admin sets "Show members from" above
 *    the hub's count and saves; the card says how many members there are.
 * 2. Below the threshold a resident sees no count and no Members section or
 *    page, and still has Share this hub; the admin sees the count, a note that
 *    only admins see it, and Members in the menus.
 * 3. "Show the Members page before then" brings the page and its section back
 *    for residents; the count still waits.
 * 4. Switched off, Members is gone from the menus and the page for everyone.
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { localRest, storedSetting } from "../fixtures/adminSession.js";
import { adminEmailFor, hubId, run, session, visitAs } from "./actors";
import { E2E_API_BASE as API } from "./hubApi";

const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 900 };
const KEYS = ["plugin.members.enabled", "plugin.members.min_count", "plugin.members.page_before_threshold"];

let hub = "";
let adminToken = "";
let residentToken = "";
let restore: Array<[string, string | undefined]> = [];

async function put(request: APIRequestContext, values: Record<string, string>) {
  const res = await request.put(`${API}/admin/hub/settings`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { section: "plugins", values },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function openMore(page: Page) {
  await page.getByRole("navigation", { name: "Sections", exact: true }).locator('[data-nav-id="more"]').click();
  await expect(page.getByTestId("more-sheet")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  hub = await hubId(request);
  adminToken = (await session(hub, adminEmailFor(hub))).token;
  const email = `members-plugin-${run}@example.test`;
  residentToken = (await session(hub, email)).token;
  await localRest(`users?hub_id=eq.${hub}&email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ is_resident: true, full_name: "Members Plugin Resident" }),
  });
  restore = await Promise.all(KEYS.map(async (k) => [k, await storedSetting(hub, k)] as [string, string | undefined]));
});

test.afterAll(async ({ request }) => {
  await put(request, {
    "plugin.members.enabled": restore[0][1] ?? "true",
    "plugin.members.min_count": restore[1][1] ?? "",
    "plugin.members.page_before_threshold": restore[2][1] ?? "false",
  });
});

test("1. an admin sets the threshold in Hub settings → Plugins → Members", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await visitAs(page, adminToken);
  await page.goto("/admin/settings/plugins#members");
  const card = page.getByRole("region", { name: "Members" });
  await expect(card.getByTestId("members-now")).toContainText(/This hub has [\d,]+ members/);
  await card.getByRole("spinbutton", { name: "Show members from" }).fill("100000");
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByText(/^Saved\./)).toBeVisible();
  await expect(card.getByTestId("members-now")).toContainText("residents don't see the count yet");
});

test("2. below the threshold: a resident sees no count and no Members, and still shares; the admin sees both", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await visitAs(page, residentToken);
  await page.goto("/");
  await expect(page.getByTestId("member-stack")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("button", { name: "Share this hub" })).toBeVisible();
  await openMore(page);
  await expect(page.getByTestId("more-sheet").locator('[data-nav-id="members"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/members");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

  // The admin, in a page of their own (visitAs signs every navigation in).
  const admin = await page.context().newPage();
  await admin.setViewportSize(PHONE);
  await visitAs(admin, adminToken);
  await admin.goto("/");
  await expect(admin.getByTestId("member-stack")).toBeVisible();
  await expect(admin.getByTestId("member-count-admin-only")).toContainText("Only admins see this until 100000 members");
  await openMore(admin);
  await expect(admin.getByTestId("more-sheet").locator('[data-nav-id="members"]')).toBeVisible();
  await admin.close();
});

test("3. the override shows the page and its section before the threshold; the count still waits", async ({ page, request }) => {
  await put(request, { "plugin.members.page_before_threshold": "true" });
  await page.setViewportSize(PHONE);
  await visitAs(page, residentToken);
  await page.goto("/");
  await expect(page.getByTestId("member-stack")).toHaveCount(0);
  await openMore(page);
  await page.getByTestId("more-sheet").locator('[data-nav-id="members"]').click();
  await expect(page).toHaveURL(/\/members$/);
  await expect(page.getByRole("heading", { name: "Members", level: 1 })).toBeVisible();
});

test("4. switched off, Members is gone from the menus and the page, for admins too", async ({ page, request }) => {
  await put(request, { "plugin.members.enabled": "false" });
  await page.setViewportSize(DESKTOP);
  await visitAs(page, adminToken);
  await page.goto("/");
  await expect(page.getByTestId("member-stack")).toHaveCount(0);
  await page.goto("/members");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await openMore(page);
  await expect(page.getByTestId("more-sheet").locator('[data-nav-id="members"]')).toHaveCount(0);
});
