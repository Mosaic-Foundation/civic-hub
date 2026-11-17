/**
 * Legal 1.5 (2026-11-17) is material (the Privacy Policy's About you and
 * ballot tags): someone who accepted 1.4 is shown "We've updated our Terms",
 * as is anyone older; accepting stamps 1.5, and then the dialog is gone.
 */

import { expect, test } from "@playwright/test";
import { localRest } from "../fixtures/adminSession.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";
import { hubId, run, session, visitAs } from "./actors";

async function withVersion(hub: string, label: string, version: string) {
  const email = `legal-${label}-${run}@example.test`;
  const s = await session(hub, email);
  await localRest(`users?hub_id=eq.${hub}&email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ tos_version_accepted: version }),
  });
  return { ...s, email };
}

test("accepted 1.4: the dialog asks, and accepting records 1.5", async ({ page, request }) => {
  expect(CURRENT_LEGAL_VERSION).toBe("1.5");
  const hub = await hubId(request);
  const { token, email } = await withVersion(hub, "14", "1.4");
  await visitAs(page, token);
  await page.goto("/votes");
  await expect(page.getByRole("button", { name: /^Account menu/ })).toBeVisible({ timeout: 15_000 });
  const dialog = page.getByRole("alertdialog", { name: "We've updated our Terms" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toContainText("Version 1.5");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog).toHaveCount(0);
  const [u] = (await localRest(`users?hub_id=eq.${hub}&email=eq.${encodeURIComponent(email)}&select=tos_version_accepted`)) as Array<{ tos_version_accepted: string }>;
  expect(u.tos_version_accepted).toBe("1.5");
});

test("accepted 1.5: no dialog", async ({ page, request }) => {
  const hub = await hubId(request);
  const { token } = await withVersion(hub, "15", "1.5");
  await visitAs(page, token);
  await page.goto("/votes");
  // The account has loaded (the dialog decides from it), so "no dialog" means something.
  await expect(page.getByRole("button", { name: /^Account menu/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("alertdialog", { name: "We've updated our Terms" })).toHaveCount(0);
});
