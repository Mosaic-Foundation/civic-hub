/**
 * Handing a hub over (session 4, 2026-10-08).
 *
 * 1. The Feedback page shows the hub's own feedback address (docs item #6),
 *    set in Settings → Plugins, and the platform's when the hub has none.
 * 2. The console's Handover panel edits what residents see on a demo hub,
 *    says what a rename carried, and shows mode and plugins read-only with
 *    links to the hub's own Settings (review R48, R10, R11).
 * 3. Settings → Copy calls the short form "Board label".
 *
 * Needs the console's env on the API (CIVIC_CONSOLE_HOSTNAME=console.localhost,
 * CIVIC_CONSOLE_ADMIN_EMAIL=operator@example.test) and the UI dev server, which
 * serves the console at http://console.localhost:5173/console.html.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { localRest, mintSession, storedSetting } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";
import { E2E_API_BASE as API } from "./hubApi";

const CONSOLE_UI = "http://console.localhost:5173/console.html";

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

test.describe("the console's Handover panel", () => {
  const run = Date.now().toString(36);
  const slug = `e2e-ho-${run}`;

  test.beforeAll(async () => {
    const cookie = await mintConsoleSession();
    const res = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: { slug, name: "E2E Handover Hub", hostname: `${slug}.localhost`, admin_email: `ho-${run}@example.test`, hub_kind: "organization" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  test.afterAll(async () => {
    const code = String(100000 + Math.floor(Math.random() * 899999));
    await plantCode("step_up", code);
    await consoleCall("POST", `/control/hubs/${slug}/archive`, { cookie: await mintConsoleSession(), body: { step_up_code: code } });
  });

  test("edits a demo hub's ownership details, says what a rename carried, and shows mode and plugins read-only", async ({ page, context }) => {
    const cookie = await mintConsoleSession();
    const [name, value] = cookie.split("=");
    await context.addCookies([{ name, value: decodeURIComponent(value), domain: "console.localhost", path: "/" }]);
    await page.goto(`${CONSOLE_UI}#/hubs/${slug}`);

    const panel = page.getByRole("form", { name: "Handover" });
    await expect(panel).toBeVisible();
    await panel.getByLabel("Hub name").fill("E2E Renamed Hub");
    await panel.getByLabel("Postal address").fill("PO Box 7, Testing");
    await panel.getByRole("button", { name: "Save handover details" }).click();

    await expect(page.getByRole("status").first()).toContainText("Also changed, because they still read the old name");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E Renamed Hub");
    await expect(page.getByRole("form", { name: "Handover" }).getByLabel("Email from name")).toHaveValue("E2E Renamed Hub");

    // Mode and plugins are the hub's admins': shown, with a link to their Settings.
    await expect(page.getByRole("link", { name: "Open Settings → Mode" })).toHaveAttribute(
      "href",
      `http://${slug}.localhost/admin/settings/mode`,
    );
    const plugins = page.getByRole("region", { name: "Plugins" });
    await expect(plugins.getByRole("checkbox")).toHaveCount(0);
    await expect(plugins.getByRole("link", { name: "Open Settings → Plugins" })).toBeVisible();
  });
});
