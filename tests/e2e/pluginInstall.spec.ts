/**
 * Install and Remove on the Plugins page (plugin session 1, ADR-014), as a
 * hub's admin:
 *   - Install shows what the plugin will be able to do, in plain words, and
 *     the version Civic.Social checked;
 *   - Remove → Stop now: the card reads "Not installed", Install brings it
 *     back; Wind down is not offered for items that never close;
 *   - Remove → Wind down, with an open vote: the card reads "Winding down"
 *     with the open count, and "Keep it installed" puts it back;
 *   - the hub features keep their switches, untouched.
 *
 * On whichever hub `localhost` resolves to (CIVIC_DEV_HUB; Athens on the local
 * stack with CI's env), with a session written into the LOCAL stack. Every
 * change is put back, in afterEach.
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";
import { E2E_API_BASE as API } from "./hubApi";

async function hubId(request: APIRequestContext): Promise<string> {
  return ((await (await request.get(`${API}/hub-config`)).json()) as { hub: { id: string } }).hub.id;
}

async function adminSession(hub: string): Promise<string> {
  const email = hub === "floyd" ? "admin@example.test" : `admin+${hub}@example.test`;
  const token = await mintSession(hub, email);
  await localRest(`users?hub_id=eq.${hub}&email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ tos_version_accepted: CURRENT_LEGAL_VERSION }),
  });
  return token;
}

async function visitAs(page: Page, token: string) {
  await page.addInitScript((t) => {
    localStorage.setItem("seen_intro_popup", "true");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
    sessionStorage.setItem("civic_preview", "1");
    localStorage.setItem("civic_auth_token", t);
  }, token);
}

async function install(request: APIRequestContext, token: string, plugin: string) {
  const res = await request.post(`${API}/admin/hub/plugins/${plugin}/install`, { headers: { Authorization: `Bearer ${token}` }, data: {} });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.describe("Install and Remove on the Plugins page", () => {
  let putBack: (() => Promise<void>) | null = null;
  test.afterEach(async () => {
    await putBack?.();
    putBack = null;
  });

  test("Stop now and Install, with what the plugin may do in plain words; the hub features keep their switches", async ({ page, request }) => {
    const token = await adminSession(await hubId(request));
    putBack = () => install(request, token, "wordcloud");
    await visitAs(page, token);
    await page.goto("/admin/settings/plugins#wordcloud");
    const card = page.getByRole("region", { name: "Word clouds", exact: true });
    await expect(card.getByText("version 0.1.1", { exact: false })).toBeVisible();

    await card.getByRole("button", { name: "Remove…" }).click();
    const remove = page.getByRole("dialog", { name: "Remove Word clouds?" });
    await expect(remove.getByText("What it holds doesn't close by itself, so it can only be stopped.")).toBeVisible();
    await expect(remove.getByLabel(/Wind down/)).toBeDisabled();
    await remove.getByRole("button", { name: "Stop now", exact: true }).click();
    await expect(card.getByText("Not installed.", { exact: true })).toBeVisible();
    await expect(card.locator(".plugin-card-state")).toHaveText("Not installed");

    await card.getByRole("button", { name: "Install…" }).click();
    const dialog = page.getByRole("dialog", { name: "Install Word clouds?" });
    await expect(dialog.getByText("Word clouds will be able to:")).toBeVisible();
    await expect(dialog.getByText(/Keep its own records on this hub: residents' one-word answers/)).toBeVisible();
    await expect(dialog.getByText("It will not be able to:")).toBeVisible();
    await expect(dialog.getByText("Send email.", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/Version 0\.1\.1, checked by Civic\.Social on/)).toBeVisible();
    await dialog.getByRole("button", { name: "Install", exact: true }).click();
    await expect(card.locator(".plugin-card-state")).toHaveText("Installed");

    // A hub feature keeps its switch.
    await page.goto("/admin/settings/plugins#search");
    const search = page.getByRole("region", { name: "Search", exact: true });
    await expect(search.getByLabel("Search on", { exact: true })).toBeVisible();
    await expect(search.getByRole("button", { name: "Remove…" })).toHaveCount(0);
  });

  test("Wind down with an open vote, then keep it installed", async ({ page, request }) => {
    const token = await adminSession(await hubId(request));
    putBack = () => install(request, token, "vote");
    const created = await request.post(`${API}/process`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        definition: { type: "civic.vote", version: "0.1" },
        title: `Wind-down vote ${Date.now()}`,
        description: "Plugin install E2E.",
        state: { config: { activation_mode: "direct" } },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    const started = await request.post(`${API}/process/${id}/action`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { type: "process.activate", payload: {} },
    });
    expect(started.ok(), await started.text()).toBeTruthy();

    await visitAs(page, token);
    await page.goto("/admin/settings/plugins#vote");
    const card = page.getByRole("region", { name: "Votes", exact: true });
    await card.getByRole("button", { name: "Remove…" }).click();
    const remove = page.getByRole("dialog", { name: "Remove Votes?" });
    await expect(remove.getByLabel(/Wind down/)).toBeChecked();
    await expect(remove.getByText(/Nothing new can be started from now on/)).toBeVisible();
    await remove.getByRole("button", { name: "Wind down", exact: true }).click();

    await expect(card.locator(".plugin-card-state")).toHaveText("Winding down");
    await expect(card.getByText(/open items? still running/)).toBeVisible();

    await card.getByRole("button", { name: "Keep it installed…" }).click();
    await page.getByRole("dialog", { name: "Install Votes?" }).getByRole("button", { name: "Install", exact: true }).click();
    await expect(card.locator(".plugin-card-state")).toHaveText("Installed");

    // The vote this made is put away: archived, as an admin would.
    await request.post(`${API}/admin/processes/${id}/archive`, { headers: { Authorization: `Bearer ${token}` }, data: {} });
  });
});
