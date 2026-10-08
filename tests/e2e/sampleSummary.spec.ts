/**
 * A demo hub's sample meeting summary and demo bar (session 3b, 2026-10-07;
 * review issue #7, #9).
 *
 * 1. The demo bar says sample items refresh and visitors' additions to them
 *    may be cleared.
 * 2. The sample meeting summary has minutes to read on the page, and its
 *    "Watch recording" and each time open a note instead of going anywhere.
 *
 * Acts on whichever hub `localhost` resolves to (Athens on the local stack
 * with CI's env), skipped unless it is a demo hub with the sample summary
 * seeded. Meeting summaries is switched on for the test and put back after.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { localRest, mintSession, storedSetting } from "../fixtures/adminSession.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";
import { E2E_API_BASE as API } from "./hubApi";

async function hubConfig(request: APIRequestContext): Promise<{ hub: { id: string; mode?: string } }> {
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

async function putPlugins(request: APIRequestContext, token: string, values: Record<string, string>) {
  const res = await request.put(`${API}/admin/hub/settings`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { section: "plugins", values },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.describe("A demo hub's sample meeting summary", () => {
  let restore: (() => Promise<void>) | null = null;
  test.afterEach(async () => {
    await restore?.();
    restore = null;
  });

  test("has minutes to read and a recording note, under a demo bar that says samples refresh", async ({
    page,
    request,
  }) => {
    const config = await hubConfig(request);
    test.skip(config.hub.mode !== "demo", "not a demo hub");
    const hubId = config.hub.id;
    const id = `proc_sample_${hubId}_meeting_summary_regular`;
    const rows = (await localRest(`processes?select=id&id=eq.${id}`)) as unknown[];
    test.skip(rows.length === 0, "no sample meeting summary seeded on this hub");

    const token = await adminSession(hubId);
    const key = "plugin.meeting_summary.enabled";
    const before = (await storedSetting(hubId, key)) ?? "true";
    await putPlugins(request, token, { [key]: "true" });
    restore = () => putPlugins(request, token, { [key]: before });

    await page.addInitScript(() => {
      localStorage.setItem("seen_intro_popup", "true");
      localStorage.setItem("welcome-banner-dismissed-v2", "true");
    });
    await page.goto(`/meeting-summary/${id}`);

    await expect(page.getByRole("region", { name: "Demo notice" })).toContainText(
      "Sample items refresh from time to time; anything you add to them may be cleared.",
    );

    // Minutes: on the page, not a PDF.
    await expect(page.getByText("Call to order.", { exact: false })).toHaveCount(0);
    await page.getByRole("button", { name: "Read the minutes" }).click();
    const minutes = page.getByRole("region", { name: "Minutes" });
    await expect(minutes).toContainText("Call to order.");
    await expect(minutes).toContainText("Adjournment.");

    // Recording: a note, and the page stays where it is.
    const url = page.url();
    await page.getByRole("button", { name: "Watch recording" }).click();
    await expect(page.getByRole("note").filter({ hasText: "In a real hub this links to the meeting video" })).toBeVisible();
    expect(page.url()).toBe(url);

    // A time says what it would open, and does not open the section.
    const block = page.locator(".meeting-block").first();
    await block.locator("button.meeting-block-timestamp").click();
    await expect(block.getByRole("status")).toContainText("In a real hub this opens the meeting video at");
    expect(await block.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
    expect(page.url()).toBe(url);
  });

  test("the About page says when it is still the standard text", async ({ page, request }) => {
    const config = await hubConfig(request);
    test.skip(config.hub.mode !== "demo", "not a demo hub");
    const docs = (await (await request.get(`${API}/hub-config/documents`)).json()) as { defaults?: string[] };
    await page.addInitScript(() => {
      localStorage.setItem("seen_intro_popup", "true");
      localStorage.setItem("welcome-banner-dismissed-v2", "true");
    });
    await page.goto("/about");
    await expect(page.locator(".legal-prose h1, .legal-prose h2").first()).toBeVisible();
    const note = page.getByRole("note").filter({ hasText: "standard About page" });
    if (docs.defaults?.includes("copy.about")) {
      await expect(note).toContainText("can rewrite it");
    } else {
      // The hub wrote its own (Athens does): no note.
      await expect(note).toHaveCount(0);
    }
  });
});
