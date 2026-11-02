/**
 * Sticky Save in admin Settings (Submit and Save, 2026-10-12). On a long
 * settings page, an unsaved change brings up a Save bar that stays in view
 * however far the admin scrolls; following a link away asks first; Discard
 * puts the bar back in its place. Nothing is saved, so the hub's copy is
 * left as it was.
 *
 * Runs on whichever hub `localhost` resolves to, as its admin, with a
 * session written into the LOCAL stack (tests/fixtures/adminSession.ts).
 */

import { test, expect } from "@playwright/test";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";
import { E2E_API_BASE as API } from "./hubApi";

test("an unsaved change keeps Save in view, and leaving asks first", async ({ page, request }) => {
  const { hub } = await (await request.get(`${API}/hub-config`)).json();
  const email = hub.id === "floyd" ? "admin@example.test" : `admin+${hub.id}@example.test`;
  const token = await mintSession(hub.id, email);
  await localRest(`users?hub_id=eq.${hub.id}&email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ tos_version_accepted: CURRENT_LEGAL_VERSION }),
  });
  await page.addInitScript((t) => {
    localStorage.setItem("seen_intro_popup", "true");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
    sessionStorage.setItem("civic_preview", "1");
    localStorage.setItem("civic_auth_token", t);
  }, token);

  await page.goto("/admin/settings/copy");
  const bar = page.getByRole("group", { name: "Save this section" });
  const save = bar.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();
  // Nothing to save: Save is disabled, and the bar is in view all the same.
  await expect(save).toBeInViewport();

  const field = page.locator(".settings-form textarea").first();
  await field.fill(`${await field.inputValue()} (edited)`);
  await expect(bar.getByText("You have unsaved changes.")).toBeVisible();

  // Scrolled to the top, Save is still in view.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(save).toBeEnabled();
  await expect(save).toBeInViewport();

  // A link away asks; staying keeps the change.
  await page.getByRole("link", { name: "Back to the hub" }).first().click();
  const asked = page.getByRole("dialog", { name: "Leave without saving?" });
  await expect(asked).toContainText("unsaved changes");
  await asked.getByRole("button", { name: "Stay on this page" }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/copy/);
  await expect(field).toHaveValue(/\(edited\)$/);

  // Back asks too; staying keeps the change and the address.
  await page.goBack();
  await expect(asked).toBeVisible();
  await asked.getByRole("button", { name: "Stay on this page" }).click();
  await expect(asked).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin\/settings\/copy/);
  await expect(field).toHaveValue(/\(edited\)$/);

  // The section list asks; leaving goes there, and the change is gone.
  await page.getByRole("link", { name: "Email", exact: true }).click();
  await expect(asked).toBeVisible();
  await asked.getByRole("button", { name: "Stay on this page" }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/copy/);

  // Discard: nothing to save, and Save goes quiet.
  await bar.getByRole("button", { name: "Discard changes" }).click();
  await expect(save).toBeDisabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Nothing unsaved, and Back is an ordinary Back: no question, no dead press.
  await page.goto("/admin/settings/email");
  await page.goto("/admin/settings/copy");
  await field.fill(`${await field.inputValue()}x`);
  await expect(save).toBeEnabled();
  await bar.getByRole("button", { name: "Discard changes" }).click();
  await expect(save).toBeDisabled();
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/settings\/email/);

  // Back and Leave goes back.
  await page.goto("/admin/settings/copy");
  await field.fill(`${await field.inputValue()}y`);
  await expect(save).toBeEnabled();
  await page.goBack();
  await asked.getByRole("button", { name: "Leave" }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/email/);
});
