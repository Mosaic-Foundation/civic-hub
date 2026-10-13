/**
 * The focused drafting layout at phone width (Submit and Save, 2026-10-12),
 * for every drafting kind: one slim row (back, "New <noun>", the saved note)
 * instead of the hub header and section tabs; the pinned bar at the bottom,
 * one row, stepping aside while a text field has focus and back after it
 * leaves; the formatting toolbar docked as one row at the bottom (above the
 * keyboard on a real phone) while its field has focus. Desktop is unchanged.
 *
 * No browser here opens a software keyboard, so "keyboard open" is the
 * field's focus, which is what the layout keys off.
 *
 * Runs on whichever hub `localhost` resolves to, as a resident whose session
 * is written into the LOCAL stack (tests/fixtures/adminSession.ts).
 */

import { test, expect, type Page } from "@playwright/test";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";
import { E2E_API_BASE as API } from "./hubApi";

const run = Date.now().toString(36);

const KINDS = [
  { path: "/propose/new", name: "New proposal", submit: "Submit proposal" },
  { path: "/votes/new", name: "New vote", submit: "Submit vote" },
  { path: "/projects/new", name: "New project", submit: /Submit/ },
  { path: "/deliberations/new", name: "New conversation", submit: "Submit conversation" },
];

async function visitAs(page: Page, token: string) {
  await page.addInitScript((t) => {
    localStorage.setItem("seen_intro_popup", "true");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
    sessionStorage.setItem("civic_preview", "1");
    localStorage.setItem("civic_auth_token", t);
  }, token);
}

test.describe("Drafting on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const [n, kind] of KINDS.entries()) {
    test(`${kind.name}: slim header, the bar steps aside while typing, the toolbar docks`, async ({ page, request }) => {
      const { hub } = await (await request.get(`${API}/hub-config`)).json();
      const email = `phone-e2e-${run}-${n}@example.test`;
      const token = await mintSession(hub.id, email);
      await localRest(`users?hub_id=eq.${hub.id}&email=eq.${encodeURIComponent(email)}`, {
        method: "PATCH",
        body: JSON.stringify({ tos_version_accepted: CURRENT_LEGAL_VERSION }),
      });
      await visitAs(page, token);
      await page.goto(kind.path);

      // One slim row instead of the hub header and section tabs.
      await expect(page.getByRole("heading", { level: 1, name: kind.name })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Back to / })).toBeVisible();
      await expect(page.locator(".civic-nav")).toBeHidden();
      await expect(page.locator(".feed-votes-tabs")).toBeHidden();

      // The bar is pinned, and steps aside while a field has focus.
      const submit = page.getByRole("button", { name: kind.submit }).last();
      await expect(submit).toBeInViewport();
      const title = page.locator("#draft-title");
      await title.click();
      await title.fill(`Phone layout ${kind.name} ${run}`);
      await expect(submit).toBeHidden();
      await expect(page.getByRole("status").filter({ hasText: "Draft saved" })).toBeVisible();

      // The formatting toolbar docks while its field has focus.
      await page.locator("#draft-description").click();
      await expect(page.locator(".md-toolbar--docked")).toBeInViewport();
      await expect(submit).toBeHidden();

      // Focus leaves: the bar is back, the toolbar in its place.
      await page.locator("#draft-description").blur();
      await expect(submit).toBeVisible();
      await expect(submit).toBeInViewport();
      await expect(page.locator(".md-toolbar--docked")).toHaveCount(0);
    });
  }

  test("desktop keeps the hub header and the full page header", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/votes/new");
    await expect(page.locator(".civic-nav")).toBeVisible();
    await expect(page.locator(".draft-phone-bar")).toHaveCount(0);
  });
});
