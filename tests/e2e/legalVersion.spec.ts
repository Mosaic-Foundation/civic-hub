/**
 * Legal 1.4 (2026-10-17) is non-material: someone who accepted 1.3 is not
 * shown "We've updated our Terms"; someone on an older version still is, as
 * the dialog behaved for 1.3; accepting stamps 1.4.
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

test("accepted 1.3: no 'We've updated our Terms' dialog under 1.4", async ({ page, request }) => {
  expect(CURRENT_LEGAL_VERSION).toBe("1.4");
  const hub = await hubId(request);
  const { token } = await withVersion(hub, "13", "1.3");
  await visitAs(page, token);
  await page.goto("/votes");
  // The account has loaded (the dialog decides from it), so "no dialog" means something.
  await expect(page.getByRole("button", { name: /^Account menu/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("alertdialog", { name: "We've updated our Terms" })).toHaveCount(0);
});

test("accepted 1.2: the dialog asks, as for 1.3, and accepting records 1.4", async ({ page, request }) => {
  const hub = await hubId(request);
  const { token, email } = await withVersion(hub, "12", "1.2");
  await visitAs(page, token);
  await page.goto("/votes");
  await expect(page.getByRole("button", { name: /^Account menu/ })).toBeVisible({ timeout: 15_000 });
  const dialog = page.getByRole("alertdialog", { name: "We've updated our Terms" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toContainText("Version 1.4");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog).toHaveCount(0);
  const [u] = (await localRest(`users?hub_id=eq.${hub}&email=eq.${encodeURIComponent(email)}&select=tos_version_accepted`)) as Array<{ tos_version_accepted: string }>;
  expect(u.tos_version_accepted).toBe("1.4");
});
