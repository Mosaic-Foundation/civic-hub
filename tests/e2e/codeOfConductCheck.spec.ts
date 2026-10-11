/**
 * The Code of Conduct check on a draft, as a resident sees it (audit A4,
 * 2026-10-11). The browser no longer tells the server "this edit did not
 * change anything" (skip_modified_flag is gone): the server decides, from
 * which field changed, whether the check must run again, and every submit
 * compares the check's hash with the text. In the form that reads as:
 *   - nothing to submit until the check has run;
 *   - after it runs, Ready to submit;
 *   - after an edit to checked text, "Draft changed", Submit disabled;
 *   - after the check runs again, Ready, and the submit goes through.
 *
 * Runs on whichever hub `localhost` resolves to, as a resident whose session
 * is written into the LOCAL stack (tests/fixtures/adminSession.ts).
 */

import { test, expect, type Page } from "@playwright/test";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";
import { E2E_API_BASE as API } from "./hubApi";

async function residentSession(hubId: string): Promise<string> {
  const email = `coc-e2e-${Date.now()}@example.test`;
  const token = await mintSession(hubId, email);
  await localRest(`users?hub_id=eq.${hubId}&email=eq.${encodeURIComponent(email)}`, {
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

test("an edit after the check needs the check again, decided by the server", async ({ page, request }) => {
  const { hub } = await (await request.get(`${API}/hub-config`)).json();
  await visitAs(page, await residentSession(hub.id));
  await page.goto("/votes/new");

  const title = page.getByPlaceholder(/Should we add sidewalks/);
  const check = page.getByRole("button", { name: "Run Code of Conduct check" });
  const submit = page.getByRole("button", { name: /Submit/ }).last();

  await title.fill("Should the library open on Sundays?");
  await expect(page.getByText("Status: Run the Code of Conduct check to prepare for submission")).toBeVisible();
  await expect(submit).toBeDisabled();

  await check.click();
  await expect(page.getByText("Status: Ready to submit")).toBeVisible();
  await expect(submit).toBeEnabled();

  // Checked text changed: the server marks the draft, the form follows.
  await title.fill("Should the library open on Sundays and holidays?");
  await expect(
    page.getByText("Status: Draft changed — run the Code of Conduct check again before submitting"),
  ).toBeVisible();
  await expect(submit).toBeDisabled();

  await check.click();
  await expect(page.getByText("Status: Ready to submit")).toBeVisible();
  await submit.click();
  // The confirmation step, then the submit itself.
  const confirm = page.getByRole("button", { name: /Submit/ }).last();
  const submitted = page.waitForResponse((r) => /\/votes\/drafts\/[^/]+\/submit$/.test(r.url()));
  await confirm.click();
  expect((await submitted).status()).toBe(201);
});
