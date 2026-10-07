/**
 * Plugin switches, end to end (2026-10-07).
 *
 * 1. An admin who switches a plugin off in Settings → Plugins sees it leave
 *    the nav at once, by in-app navigation, without reloading the page (the
 *    UI re-fetches the hub config after a save: refreshHubConfig()).
 * 2. A new sign-up on a hub whose Word clouds are off stays on the home page
 *    instead of being sent to a word cloud that answers "Page not found".
 * 3. With the Writing assistant off, a draft offers no AI help ("Get
 *    suggestions" gone) but the Code of Conduct check still runs and the
 *    draft can be submitted (Adam, 2026-10-07: the check is moderation).
 *
 * Both act on whichever hub `localhost` resolves to (CIVIC_DEV_HUB; Athens on
 * the local stack with CI's env), as its admin, with a session written into
 * the LOCAL stack (tests/fixtures/adminSession.ts refuses any other). Every
 * setting they change is put back as it was.
 *
 * API: tests/e2e/hubApi.ts (CIVIC_E2E_API_BASE, default the dev server).
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { localRest, mintSession, storedSetting } from "../fixtures/adminSession.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";

import { E2E_API_BASE as API } from "./hubApi";

interface HubConfig {
  hub: { id: string; mode?: string };
  settings: Record<string, string>;
}

async function hubConfig(request: APIRequestContext): Promise<HubConfig> {
  return (await request.get(`${API}/hub-config`)).json();
}

/** The local stack's admin for a hub: Floyd's, or Floyd's plus-addressed. */
function adminEmailFor(hubId: string): string {
  return hubId === "floyd" ? "admin@example.test" : `admin+${hubId}@example.test`;
}

/** A session for the hub's admin, whose account has accepted the current terms. */
async function adminSession(hubId: string): Promise<string> {
  const email = adminEmailFor(hubId);
  const token = await mintSession(hubId, email);
  // Otherwise the re-acceptance dialog covers the page.
  await localRest(`users?hub_id=eq.${hubId}&email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ tos_version_accepted: CURRENT_LEGAL_VERSION }),
  });
  return token;
}

async function putPlugins(request: APIRequestContext, token: string, values: Record<string, string>) {
  const res = await request.put(`${API}/admin/hub/settings`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { section: "plugins", values },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Remember these settings now; the returned function puts them back. */
async function remember(request: APIRequestContext, hubId: string, token: string, keys: string[]) {
  const config = await hubConfig(request);
  const before = await Promise.all(keys.map(async (k) => [k, await storedSetting(hubId, k), config.settings[k]] as const));
  return async () => {
    await putPlugins(
      request,
      token,
      Object.fromEntries(before.map(([k, stored, effective]) => [k, stored ?? effective ?? ""])),
    );
    for (const [k, stored] of before) {
      if (stored === undefined) await localRest(`hub_settings?hub_id=eq.${hubId}&key=eq.${k}`, { method: "DELETE" });
    }
  };
}

async function visitAs(page: Page, token: string | null) {
  await page.addInitScript((t) => {
    localStorage.setItem("seen_intro_popup", "true");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
    sessionStorage.setItem("civic_preview", "1");
    if (t) localStorage.setItem("civic_auth_token", t);
  }, token);
}

test.describe("Plugin switches", () => {
  // Put back what a test changed, in a hook so it runs even when the test
  // times out (a `finally` inside the test does not: its request context is
  // gone by then).
  let restore: (() => Promise<void>) | null = null;
  test.afterEach(async () => {
    await restore?.();
    restore = null;
  });

  test("switching Projects off in Settings takes it out of the nav at once, without a reload", async ({ page, request }) => {
    const { hub, settings } = await hubConfig(request);
    test.skip(settings["plugin.project.enabled"] === "false", "Projects is already off on this hub");
    const token = await adminSession(hub.id);
    restore = await remember(request, hub.id, token, ["plugin.project.enabled"]);

    {
      await visitAs(page, token);
      await page.goto("/admin/settings/plugins");
      const card = page.getByRole("region", { name: "Projects", exact: true });
      await expect(card.getByLabel("Projects", { exact: true })).toBeChecked();

      // Marks this document: a reload would lose it.
      await page.evaluate(() => ((window as unknown as { __sameDocument: boolean }).__sameDocument = true));

      await card.getByLabel("Projects", { exact: true }).uncheck();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
      // The save message no longer tells the admin to reload.
      await expect(page.getByRole("status").filter({ hasText: "It shows on this page now" })).toBeVisible();

      const tabs = page.getByRole("navigation", { name: "Primary content" });
      await tabs.getByRole("link", { name: "Feed", exact: true }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(tabs.getByRole("link", { name: "Projects", exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);

      // Switched back on, it returns the same way.
      await page.goto("/admin/settings/plugins");
      await page.evaluate(() => ((window as unknown as { __sameDocument: boolean }).__sameDocument = true));
      await card.getByLabel("Projects", { exact: true }).check();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
      await tabs.getByRole("link", { name: "Feed", exact: true }).click();
      await expect(tabs.getByRole("link", { name: "Projects", exact: true })).toHaveCount(1);
      expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
    }
  });

  test("with the Writing assistant off, a draft keeps the Code of Conduct check and loses the AI help", async ({ page, request }) => {
    const { hub } = await hubConfig(request);
    const token = await adminSession(hub.id);
    restore = await remember(request, hub.id, token, ["plugin.assistant.enabled"]);
    await putPlugins(request, token, { "plugin.assistant.enabled": "false" });

    await visitAs(page, token);
    await page.goto("/votes/new");
    await page.getByPlaceholder(/Should we add sidewalks/).fill("Should the library open on Sundays?");
    const check = page.getByRole("button", { name: "Run Code of Conduct check" });
    await expect(check).toBeVisible();
    await expect(page.getByRole("button", { name: "Get suggestions" })).toHaveCount(0);

    await check.click();
    await expect(page.getByText("Status: Ready to submit")).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit vote" })).toBeEnabled();
  });

  test("a new sign-up with Word clouds off lands on the home page", async ({ page, request }) => {
    const { hub } = await hubConfig(request);
    // Only a demo hub accepts any six digits; elsewhere a real code is mailed.
    test.skip(hub.mode !== "demo", `localhost serves ${hub.id} in ${hub.mode ?? "env"} mode, not demo`);
    const token = await adminSession(hub.id);
    restore = await remember(request, hub.id, token, ["plugin.wordcloud.enabled", "plugin.wordcloud.onboarding_id"]);

    {
      // A word cloud for new accounts, named while Word clouds is on (the
      // setting is checked against the hub's processes), then switched off.
      await putPlugins(request, token, { "plugin.wordcloud.enabled": "true" });
      const created = await request.post(`${API}/process`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          definition: { type: "civic.wordcloud", version: "0.1" },
          title: `Onboarding cloud ${Date.now()}`,
          description: "Plugin switch E2E.",
          state: { prompts: [{ id: "p1", text: "One word?" }] },
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const body = await created.json();
      const cloudId: string = body.id ?? body.process?.id;
      await putPlugins(request, token, { "plugin.wordcloud.onboarding_id": cloudId });
      await putPlugins(request, token, { "plugin.wordcloud.enabled": "false" });

      await visitAs(page, null);
      await page.goto("/");
      await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
      await page.getByPlaceholder("you@example.com").fill(`new+${Date.now()}@example.test`);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByPlaceholder("------").fill("123456");
      await page.getByRole("button", { name: "Verify", exact: true }).click();
      await expect(page.locator(".auth-legal-checkbox")).toBeVisible();
      const name = page.getByPlaceholder("Jane Doe");
      if (await name.count()) await name.fill("New Member");
      await page.locator(".auth-legal-checkbox input[type=checkbox]").check();
      await page.locator(".auth-continue-button").click();

      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByText("Page not found")).toHaveCount(0);
    }
  });
});
