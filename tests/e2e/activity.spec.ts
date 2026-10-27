/**
 * Activity, the participation record (the analytics slice, 2026-10-27;
 * ADR-016), on the hub `localhost` resolves to, as its admin; and in the
 * console, as its operator.
 *
 * 1. Admin → Activity: the tab, the period's totals, every kind, the three
 *    funder measures with how each is counted, Recount now and the CSV.
 * 2. Reporting keys: issued, shown once, listed by its last four characters,
 *    a read with it logged on the page, revoked.
 * 3. Public numbers: switched on in Plugins, the About page shows "This hub
 *    in numbers" and /analytics answers; switched off, both are gone.
 * 4. The console's Dashboard: the Activity tile, its tab, and a hub's
 *    breakdown by kind.
 *
 * Settings it changes are put back through the API.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { storedSetting } from "../fixtures/adminSession.js";
import { mintConsoleSession } from "../fixtures/consoleCall.js";
import { adminEmailFor, hubId, run, session, visitAs } from "./actors";
import { E2E_API_BASE as API } from "./hubApi";

const UI = new URL(process.env.CIVIC_E2E_UI_ORIGIN?.trim() || "http://localhost:5173");
const CONSOLE_UI = `${UI.protocol}//console.localhost${UI.port ? `:${UI.port}` : ""}/console.html`;
const DESKTOP = { width: 1280, height: 900 };
const PUBLIC = "plugin.analytics.public_numbers";

let hub = "";
let adminToken = "";
let before: string | undefined;

async function setPublic(request: APIRequestContext, on: boolean) {
  const res = await request.put(`${API}/admin/hub/settings`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { section: "plugins", values: { [PUBLIC]: on ? "true" : "false" } },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  hub = await hubId(request);
  adminToken = (await session(hub, adminEmailFor(hub))).token;
  before = await storedSetting(hub, PUBLIC);
  await setPublic(request, false);
  const recount = await request.post(`${API}/admin/analytics/refresh`, { headers: { Authorization: `Bearer ${adminToken}` }, data: {} });
  expect(recount.ok(), await recount.text()).toBeTruthy();
});

test.afterAll(async ({ request }) => {
  await setPublic(request, before === "true");
});

test("1. Admin → Activity: totals, kinds, the funder measures, Recount now and the CSV", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await visitAs(page, adminToken);
  await page.goto("/admin/reviews");
  await page.getByRole("navigation", { name: "Admin sections" }).getByRole("link", { name: "Activity" }).click();
  await expect(page).toHaveURL(/\/admin\/activity$/);
  await expect(page.getByRole("heading", { level: 1, name: /Activity/ })).toBeVisible();
  await expect(page.getByTestId("activity-period")).toContainText(/so far/);
  await expect(page.getByTestId("activity-total-active_residents")).toContainText(/\d/);
  await expect(page.getByTestId("activity-by-type").getByRole("row")).toHaveCount(11); // the header and ten kinds (Events, 2026-10-27)
  const measures = page.getByTestId("activity-measures");
  for (const name of ["Attended a public meeting", "Worked with neighbours on something", "Contacted an official"]) {
    await expect(measures.getByRole("heading", { name })).toBeVisible();
  }
  await measures.getByText("How this is counted").first().click();
  await expect(measures.getByText(/Period: \d{4}-\d{2}-\d{2} to/).first()).toBeVisible();

  await page.getByRole("button", { name: "Quarter" }).click();
  await expect(page.getByTestId("activity-period")).toContainText(/^Q\d \d{4}/);
  await page.getByRole("button", { name: "Recount now" }).click();
  await expect(page.getByRole("button", { name: "Recount now" })).toBeEnabled();

  const download = page.waitForEvent("download");
  await page.getByTestId("activity-csv").click();
  expect((await download).suggestedFilename()).toMatch(/^activity-quarter-\d{4}-\d{2}-01\.csv$/);
});

test("2. a reporting key: issued once, its reads logged, revoked", async ({ page, request }) => {
  await page.setViewportSize(DESKTOP);
  await visitAs(page, adminToken);
  await page.goto("/admin/activity");
  const org = `E2E Foundation ${run}`;
  await page.getByLabel("Organisation").fill(org);
  await page.getByLabel("Contact").fill("data@example.test");
  await page.getByLabel("What it is for").fill("An end-to-end test");
  await page.getByRole("button", { name: "Issue a key" }).click();
  const issued = page.getByTestId("activity-issued-key");
  await expect(issued).toContainText(`The key for ${org}`);
  const key = (await issued.locator("code.activity-key").textContent())!.trim();
  expect(key).toMatch(/^csr_/);

  const read = await request.get(`${API}/analytics?period=month`, { headers: { Authorization: `Bearer ${key}` } });
  expect(read.status()).toBe(200);
  await page.reload();
  await expect(page.getByTestId("activity-issued-key")).toHaveCount(0);
  const row = page.getByTestId("activity-keys").getByRole("row", { name: new RegExp(org) });
  await expect(row).toContainText(`…${key.slice(-4)}`);
  await expect(page.getByTestId("activity-reads")).toContainText(org);

  await row.getByRole("button", { name: "Revoke" }).click();
  await row.getByRole("button", { name: "Revoke it" }).click();
  await expect(row).toContainText("Revoked");
  expect((await request.get(`${API}/analytics`, { headers: { Authorization: `Bearer ${key}` } })).status()).toBe(401);
});

test("3. Public numbers: on, the About page shows the hub in numbers; off, it is gone", async ({ page, request }) => {
  await page.setViewportSize(DESKTOP);
  await visitAs(page, adminToken);
  await page.goto("/admin/settings/plugins#analytics");
  const card = page.getByRole("region", { name: "Activity" });
  await card.getByRole("checkbox", { name: "Public numbers" }).check();
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByText(/^Saved\./)).toBeVisible();

  const visitor = await page.context().browser()!.newPage();
  await visitor.goto(page.url().replace(/\/admin.*$/, "/about"));
  await expect(visitor.getByTestId("about-numbers")).toBeVisible();
  await expect(visitor.getByTestId("about-numbers")).toContainText("Residents who took part");
  expect((await request.get(`${API}/analytics`)).status()).toBe(200);

  await setPublic(request, false);
  await visitor.reload();
  await expect(visitor.getByRole("heading", { name: /^About/ }).first()).toBeVisible();
  await expect(visitor.getByTestId("about-numbers")).toHaveCount(0);
  expect((await request.get(`${API}/analytics`)).status()).toBe(404);
  await visitor.close();
});

test("4. the console: the Activity tile, its tab, and one hub's numbers by kind", async ({ page, context }) => {
  const cookie = await mintConsoleSession();
  const [name, value] = cookie.split("=");
  await context.addCookies([{ name, value: decodeURIComponent(value), domain: "console.localhost", path: "/" }]);
  await page.setViewportSize(DESKTOP);
  await page.goto(`${CONSOLE_UI}#/dashboard`);
  await expect(page.getByText("active residents this month")).toBeVisible({ timeout: 40_000 });
  await page.getByRole("link", { name: "Activity", exact: true }).first().click();
  const table = page.getByTestId("dash-activity");
  await expect(table.getByTestId(`dash-activity-${hub}`)).toBeVisible();
  await page.getByRole("button", { name: "Since launch" }).click();
  await table.getByTestId(`dash-activity-${hub}`).getByRole("button").click();
  await expect(page.getByTestId(`dash-activity-types-${hub}`)).toContainText("Votes");
  await expect(table.locator("tfoot")).toContainText("All hubs");
});
