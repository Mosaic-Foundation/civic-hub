/**
 * Invite codes and the start page (session 4b, 2026-10-08): Adam's first
 * use, end to end. He mints a code in the console; his colleague enters it
 * on the start page, signs in, fills the form and lands on the new hub as
 * its admin, signed in; the console then shows the code used.
 *
 * Needs, on the API: the console's env (CIVIC_CONSOLE_HOSTNAME=console.localhost,
 * CIVIC_CONSOLE_ADMIN_EMAIL=operator@example.test) and
 * CIVIC_START_HOSTNAME=start.localhost, with CIVIC_UI_BASE_URL naming the UI's
 * origin (the handoff link goes to http://<slug>.localhost:<that port>/).
 * And a UI that serves the hub, the console and the start page on one origin
 * with /api proxied keeping Host — a production build behind `vite preview`
 * (TESTING.md has the command). The sign-in code is planted, as no mail is sent.
 */

import { test, expect } from "@playwright/test";
import { localRest } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";
import { plantStartCode } from "../fixtures/startCall.js";

const UI = new URL(process.env.CIVIC_E2E_UI_ORIGIN?.trim() || "http://localhost:5173");
const at = (host: string, path: string) => `${UI.protocol}//${host}${UI.port ? `:${UI.port}` : ""}${path}`;
const CONSOLE_PAGE = at("console.localhost", "/console.html");
const START_PAGE = at("start.localhost", "/start.html");

const run = Date.now().toString(36);
const created: string[] = [];

test.afterAll(async () => {
  const cookie = await mintConsoleSession();
  for (const id of created) {
    const code = String(100000 + Math.floor(Math.random() * 899999));
    await plantCode("step_up", code);
    await consoleCall("POST", `/control/hubs/${id}/archive`, { cookie, body: { step_up_code: code } });
  }
});

test("Adam mints a code; his colleague makes a hub with it and lands in it as admin", async ({ browser }) => {
  test.setTimeout(90_000);

  // --- Adam, in the console ---
  const adam = await browser.newContext();
  const token = (await mintConsoleSession()).split("=")[1]!;
  await adam.addCookies([{ name: "civic_console", value: decodeURIComponent(token), domain: "console.localhost", path: "/" }]);
  const consolePage = await adam.newPage();
  await consolePage.goto(CONSOLE_PAGE);
  await consolePage.getByRole("link", { name: "Invite codes" }).click();
  await expect(consolePage.getByRole("heading", { name: "Invite codes" })).toBeVisible();
  await consolePage.getByLabel("Who it's for").fill(`Colleague ${run}`);
  await consolePage.getByRole("button", { name: "Mint a code" }).click();
  const codeText = consolePage.locator(".cx-minted-code");
  await expect(codeText).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  const code = (await codeText.textContent())!.trim();
  await expect(consolePage.getByText("This is the only time the code is shown")).toBeVisible();
  await consolePage.getByRole("button", { name: "Done" }).click();
  const row = consolePage.getByRole("row", { name: new RegExp(`Colleague ${run}`) });
  await expect(row).toContainText("unused");
  await expect(row).toContainText(code.slice(-4));

  // --- The colleague, on the start page ---
  const colleague = await browser.newContext();
  const page = await colleague.newPage();
  await page.goto(START_PAGE);
  await expect(page.getByRole("heading", { name: "Start your Civic Hub" })).toBeVisible();

  // A wrong code first: the one answer, no hint why.
  await page.getByLabel("Invite code").fill("ZZZZ-ZZZZ-ZZZZ");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toHaveText(/That code can't be used/);

  await page.getByLabel("Invite code").fill(code.toLowerCase());
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  const email = `colleague-${run}@example.test`;
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByText("A code is on its way")).toBeVisible();
  await plantStartCode(email, "314159");
  await page.getByLabel("Six-digit code").fill("314159");
  await page.getByRole("button", { name: "Sign in" }).click();

  // --- The form ---
  await expect(page.getByRole("heading", { name: "Create your hub" })).toBeVisible();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  // The place picker's two selects, State then Type ("State" is also a Type, so not by text).
  const selects = page.locator("fieldset", { hasText: "Place" }).locator("select");
  await selects.nth(0).selectOption({ label: "Virginia" });
  await selects.nth(1).selectOption({ label: "County" });
  await page.getByPlaceholder("Start typing…").fill("Pulaski");
  await page.getByRole("option", { name: /Pulaski County/ }).first().click();
  // Suggested from the place: the name, the governing body, the time zone.
  await expect(page.getByLabel("Hub name")).toHaveAttribute("placeholder", /Pulaski/);
  // The time zone is a dropdown, showing the state's zone until another is chosen.
  await expect(page.getByLabel("Time zone")).toHaveValue("America/New_York");
  await expect(page.getByLabel("Time zone").locator("option", { hasText: "Pacific (Los Angeles)" })).toHaveCount(1);
  const slug = `e2e-start-${run}`;
  await page.locator("#st-slug").fill(slug);
  await expect(page.getByText(".localhost")).toBeVisible();
  await page.getByLabel("Time zone").selectOption("America/Chicago");
  await page.getByLabel("Operated by").fill(`The ${run} Group`);
  await page.getByRole("button", { name: "Create my hub" }).click();

  // --- Lands on the new hub, signed in, as its admin ---
  await page.waitForURL(new RegExp(`^${UI.protocol}//${slug}\\.localhost`), { timeout: 30_000 });
  created.push(slug);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("civic_auth_token"))).toMatch(/^sess_/);
  const me = await page.evaluate(async () => {
    const res = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${localStorage.getItem("civic_auth_token")}` } });
    return res.json();
  });
  expect(me.role).toBe("admin");
  expect(me.user.email).toBe(email);

  // "Your hub is ready: check your email", once, instead of the visitor's
  // popup; the terms prompt waits until it is closed (2026-10-08).
  const ready = page.getByRole("dialog", { name: /is ready/ });
  await expect(ready).toBeVisible();
  await expect(ready).toContainText("Check your email");
  await expect(ready).toContainText(email);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  if (process.env.CIVIC_E2E_SHOT) await page.screenshot({ path: process.env.CIVIC_E2E_SHOT });
  await ready.getByRole("button", { name: "Look around first" }).click();
  await expect(ready).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Before you continue…" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("dialog", { name: /is ready/ })).toHaveCount(0);
  const settings = (await localRest(`hub_settings?hub_id=eq.${slug}&key=eq.legal.operator_name&select=value`)) as Array<{ value: string }>;
  expect(settings[0]!.value).toBe(`The ${run} Group`);
  const zone = (await localRest(`hub_settings?hub_id=eq.${slug}&key=eq.identity.timezone&select=value`)) as Array<{ value: string }>;
  expect(zone[0]!.value).toBe("America/Chicago");

  // --- Back in the console: the code is used, by the colleague, for that hub ---
  await consolePage.reload();
  const used = consolePage.getByRole("row", { name: new RegExp(`Colleague ${run}`) });
  await expect(used).toContainText("used");
  await expect(used.getByRole("link", { name: slug })).toBeVisible();
  await expect(used).toContainText(email);
  await expect(used.getByRole("button", { name: "Revoke" })).toHaveCount(0);

  await adam.close();
  await colleague.close();
});

test("the start page on a phone fits the width", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await page.goto(START_PAGE);
  await expect(page.getByRole("heading", { name: "Start your Civic Hub" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await ctx.close();
});
