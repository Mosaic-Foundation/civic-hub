/**
 * The console's Dashboard (the dashboard slice, 2026-10-17).
 *
 * 1. The operator opens it at desktop width: the Overview's tiles and "Needs
 *    a look", then each tab with its filters: a hub that never answers shown
 *    down, one that answers on its retry shown slow, the outside services "not
 *    connected" with their setup, the jobs, the waiting counts with links to
 *    the hub's own queues, and Refresh.
 * 2. The same at phone width (375 px): nothing scrolls sideways, and the
 *    rows stack.
 * 3. A hub admin has no Dashboard: none in the hub's Admin menu, and the
 *    console asks a hub admin to sign in as the console's operator.
 *
 * Needs the console's env on the API (CIVIC_CONSOLE_HOSTNAME=console.localhost,
 * CIVIC_CONSOLE_ADMIN_EMAIL=operator@example.test) and CIVIC_DASHBOARD_FAKE=on,
 * so hubs' health is read from the API itself and a "slow" hub never answers.
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";
import { adminEmailFor, hubId, run, session, visitAs } from "./actors";

const UI = new URL(process.env.CIVIC_E2E_UI_ORIGIN?.trim() || "http://localhost:5173");
const CONSOLE_UI = `${UI.protocol}//console.localhost${UI.port ? `:${UI.port}` : ""}/console.html`;
const SLOW = `dash-slow-e2e-${run}`;
const FLAKY = `dash-flaky-e2e-${run}`;

async function asOperator(context: BrowserContext): Promise<void> {
  const cookie = await mintConsoleSession();
  const [name, value] = cookie.split("=");
  await context.addCookies([{ name, value: decodeURIComponent(value), domain: "console.localhost", path: "/" }]);
}

async function openDashboard(page: Page): Promise<void> {
  await page.goto(`${CONSOLE_UI}#/dashboard`);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  // The slow hub's health check runs two 8 s attempts.
  await expect(page.getByTestId("dash-gathered")).toContainText("Gathered", { timeout: 40_000 });
}

test.describe("the console's Dashboard", () => {
  test.beforeAll(async () => {
    for (const [slug, name] of [[SLOW, "E2E Slow Hub"], [FLAKY, "E2E Flaky Hub"]]) {
      const res = await consoleCall("POST", "/control/hubs", {
        cookie: await mintConsoleSession(),
        body: {
          slug,
          name,
          hostname: `${slug}.localhost`,
          admin_email: `slow-${run}@example.test`,
          jurisdiction_name: "Dashboard Test Area",
          jurisdiction_custom: true,
          jurisdiction_type: "county",
          mode: "beta",
        },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
  });

  test.afterAll(async () => {
    const code = String(100000 + Math.floor(Math.random() * 899999));
    for (const slug of [SLOW, FLAKY]) {
      await plantCode("step_up", code);
      await consoleCall("POST", `/control/hubs/${slug}/archive`, { cookie: await mintConsoleSession(), body: { step_up_code: code } });
    }
  });

  test("the operator sees every hub, the jobs, the outside services and what is waiting, at desktop width", async ({ page, context }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await asOperator(context);
    await openDashboard(page);

    await expect(page.getByRole("navigation", { name: "Console" }).getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    const tabs = page.getByRole("navigation", { name: "Dashboard sections" });
    await expect(tabs.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");

    // Overview: a tile per section, each loaded; the down hub makes Hubs red and leads "Needs a look".
    for (const id of ["hubs", "jobs", "outside", "attention"]) {
      await expect(page.getByTestId(`dash-tile-${id}`)).toHaveAttribute("data-status", "ok");
    }
    await expect(page.getByTestId("dash-tile-hubs")).toHaveAttribute("data-tone", "danger");
    const look = page.getByTestId("dash-needs-look");
    await expect(look.locator(".cx-dash-concern-danger", { hasText: "E2E Slow Hub is down: no answer in 8 s" })).toBeVisible();
    await expect(look.locator(".cx-dash-concern-warn", { hasText: "E2E Flaky Hub was slow to answer" })).toBeVisible();
    await expect(tabs.getByTestId("dash-tab-hubs")).toContainText(/Hubs\s*\d+/);

    // A tile opens its tab. Hubs opens on its problems.
    await page.getByTestId("dash-tile-hubs").click();
    await expect(page).toHaveURL(/#\/dashboard\/hubs$/);
    await expect(page.getByTestId("dash-section-hubs")).toHaveAttribute("data-status", "ok");
    const chips = page.getByRole("group", { name: "Show hubs" });
    await expect(chips.getByRole("button", { name: /^Problems/ })).toHaveAttribute("aria-pressed", "true");
    const slow = page.getByTestId(`dash-hub-${SLOW}`);
    await expect(slow).toHaveAttribute("data-health", "down");
    await expect(slow).toContainText("no answer in 8 s");
    // A failed first try that answers on the retry: slow, with the time, never down.
    const flaky = page.getByTestId(`dash-hub-${FLAKY}`);
    await expect(flaky).toHaveAttribute("data-health", "slow");
    await expect(flaky).toContainText(/slow · [\d.]+ (ms|s)/);
    await expect(flaky).toContainText("first try: connection dropped");
    await expect(page.getByTestId("dash-hub-floyd")).toHaveCount(0);
    // Every hub in service, then a search.
    await chips.getByRole("button", { name: /^In service/ }).click();
    await expect(page.getByTestId("dash-hub-floyd")).toHaveAttribute("data-health", "up");
    await page.getByRole("searchbox", { name: "Find a hub" }).fill("flaky");
    await expect(page.getByTestId(`dash-hub-${FLAKY}`)).toBeVisible();
    await expect(page.getByTestId("dash-hub-floyd")).toHaveCount(0);

    // Jobs: the backup card, and every job under "All jobs".
    await tabs.getByRole("link", { name: /^Jobs and backups/ }).click();
    await page.getByRole("group", { name: "Show jobs" }).getByRole("button", { name: /^All jobs/ }).click();
    await expect(page.getByTestId("dash-job-vote_close")).toBeVisible();
    await expect(page.getByTestId("dash-backup")).toHaveAttribute("data-state", "not_connected");

    // Uptime and errors: not connected, with how.
    await tabs.getByRole("link", { name: /^Uptime and errors/ }).click();
    for (const card of ["dash-uptime", "dash-errors"]) {
      await expect(page.getByTestId(card)).toHaveAttribute("data-state", "not_connected");
      await expect(page.getByTestId(card)).toContainText("not connected");
    }

    // Waiting: the six counts, each a link to the hub's own queue.
    await tabs.getByRole("link", { name: /^Waiting/ }).click();
    await page.getByRole("group", { name: "Show hubs" }).getByRole("button", { name: /^All hubs/ }).click();
    const floyd = page.getByTestId("dash-attention-floyd");
    await expect(floyd).toContainText("Flagged by checks");
    const reviews = floyd.locator('[data-queue="reviews"] a');
    await expect(reviews).toHaveAttribute("href", /^https?:\/\/floyd\.civic\.social(:\d+)?\/admin\/reviews$/);
    await expect(reviews).toHaveAttribute("target", "_blank");

    // Refresh asks again, and the page says when.
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled({ timeout: 40_000 });
    await expect(page.getByTestId("dash-gathered")).toContainText("just now");
  });

  test("works at phone width: tiles, tabs and rows fit, nothing scrolls sideways", async ({ page, context }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 375, height: 812 });
    await asOperator(context);
    await openDashboard(page);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

    await expect(page.getByTestId("dash-tile-hubs")).toBeVisible();
    await expect(page.getByTestId("dash-tile-attention")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);

    await page.getByTestId("dash-tile-hubs").click();
    await expect(page.getByTestId(`dash-hub-${SLOW}`)).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);

    await page.goto(`${CONSOLE_UI}#/dashboard/attention`);
    await expect(page.getByTestId("dash-section-attention")).toBeVisible({ timeout: 40_000 });
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});

test.describe("a hub admin", () => {
  test("has no Dashboard: not in the hub's Admin menu, and the console asks for its own sign-in", async ({ page, request }) => {
    const hub = await hubId(request);
    const { token } = await session(hub, adminEmailFor(hub));
    await page.setViewportSize({ width: 1280, height: 900 });
    await visitAs(page, token);
    await page.goto("/admin");
    await expect(page.getByRole("navigation", { name: "Admin sections" })).toBeVisible();
    // The Admin menu, where the navigation layout shows one.
    const adminButton = page.getByRole("button", { name: "Admin", exact: true });
    if (await adminButton.isVisible()) {
      await adminButton.click();
      await expect(page.getByRole("menu", { name: "Admin" }).getByRole("menuitem").first()).toBeVisible();
    }
    await expect(page.getByRole("menuitem", { name: /dashboard/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /dashboard/i })).toHaveCount(0);

    // The console with only a hub's session: its sign-in, no Dashboard.
    await page.goto(`${CONSOLE_UI}#/dashboard`);
    await expect(page.getByRole("button", { name: "Email me a code" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  });
});
