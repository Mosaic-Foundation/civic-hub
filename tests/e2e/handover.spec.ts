/**
 * Handing a hub over (session 4, 2026-10-08).
 *
 * 1. The Feedback page shows the hub's own feedback address (docs item #6),
 *    set in Settings → Plugins, and the platform's when the hub has none.
 * 2. Settings → Copy calls the short form "Board label".
 *
 * The console's Handover panel is the console's (Mosaic-Foundation/
 * mosaic-console); the hub's side of it is tests/api/handover.test.ts.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { localRest, mintSession, storedSetting } from "../fixtures/adminSession.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";
import { E2E_API_BASE as API } from "./hubApi";


async function hubConfig(request: APIRequestContext): Promise<{ hub: { id: string }; settings: Record<string, string> }> {
  return (await request.get(`${API}/hub-config`)).json();
}

async function adminSession(hubId: string): Promise<string> {
  const email = hubId === "floyd" ? "admin@example.test" : `admin+${hubId}@example.test`;
  const token = await mintSession(hubId, email);
  await localRest(`users?hub_id=eq.${hubId}&email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ tos_version_accepted: CURRENT_LEGAL_VERSION }),
  });
  return token;
}

async function putSettings(request: APIRequestContext, token: string, section: string, values: Record<string, string>) {
  const res = await request.put(`${API}/admin/hub/settings`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { section, values },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.describe("the Feedback page's address", () => {
  let restore: (() => Promise<void>) | null = null;
  test.afterEach(async () => {
    await restore?.();
    restore = null;
  });

  test("is the hub's own once set, and the fallback before", async ({ page, request }) => {
    const { hub } = await hubConfig(request);
    const token = await adminSession(hub.id);
    const key = "plugin.feedback.contact_email";
    const before = (await storedSetting(hub.id, key)) ?? "";
    restore = () => putSettings(request, token, "plugins", { [key]: before });

    await putSettings(request, token, "plugins", { [key]: "" });
    const settings = (await hubConfig(request)).settings;
    const fallback = settings["legal.contact_email"] || "contact@civic.social";
    await page.addInitScript(() => {
      localStorage.setItem("seen_intro_popup", "true");
      localStorage.setItem("welcome-banner-dismissed-v2", "true");
      sessionStorage.setItem("civic_preview", "1");
    });
    await page.goto("/feedback");
    await expect(page.getByRole("link", { name: fallback })).toHaveAttribute("href", `mailto:${fallback}`);

    await putSettings(request, token, "plugins", { [key]: "feedback-e2e@example.test" });
    await page.reload();
    await expect(page.getByRole("link", { name: "feedback-e2e@example.test" })).toHaveAttribute(
      "href",
      "mailto:feedback-e2e@example.test",
    );
  });
});

test.describe("Settings → Copy", () => {
  test('calls the short form "Board label"', async ({ page, request }) => {
    const { hub } = await hubConfig(request);
    const token = await adminSession(hub.id);
    await page.addInitScript((t) => {
      localStorage.setItem("seen_intro_popup", "true");
      localStorage.setItem("welcome-banner-dismissed-v2", "true");
      sessionStorage.setItem("civic_preview", "1");
      localStorage.setItem("civic_auth_token", t);
    }, token);
    await page.goto("/admin/settings/copy");
    await expect(page.getByText("Board label", { exact: true })).toBeVisible();
  });
});

