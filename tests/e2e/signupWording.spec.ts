/**
 * Demo sign-in and sign-up, end to end (session 3a, 2026-10-07).
 *
 * 1. On a demo hub the code step says any six digits work, never "Check
 *    your email", and the sign-up checkbox asks a visitor to confirm they are
 *    trying the demo, not that they live somewhere (review R22, R23).
 * 2. Signing up from a vote casts the vote that was clicked, goes through
 *    the onboarding word cloud, and Skip comes back to the vote (R24).
 *
 * Both act on whichever hub `localhost` resolves to (CIVIC_DEV_HUB; Athens on
 * the local stack with CI's env), skipped unless it is a demo hub, with
 * sessions written into the LOCAL stack only. Every setting changed is put
 * back as it was.
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

async function freshVisitor(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("seen_intro_popup", "true");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
    sessionStorage.setItem("civic_preview", "1");
  });
}

/** Email → any six digits → the gate step, as a brand-new visitor. */
async function signUpToGate(page: Page) {
  await page.getByPlaceholder("you@example.com").fill(`new+${Date.now()}@example.test`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Enter any six digits" })).toBeVisible();
  await expect(page.getByText("Check your email")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Resend code" })).toHaveCount(0);
  await page.getByPlaceholder("------").fill("123456");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.locator(".auth-legal-checkbox")).toBeVisible();
}

async function passGate(page: Page) {
  const name = page.getByPlaceholder("Jane Doe");
  if (await name.count()) await name.fill("New Member");
  await page.locator(".auth-legal-checkbox input[type=checkbox]").check();
  await page.locator(".auth-continue-button").click();
}

test.describe("Demo sign-in and sign-up", () => {
  let restore: (() => Promise<void>) | null = null;
  test.afterEach(async () => {
    await restore?.();
    restore = null;
  });

  test("the code step and the checkbox speak to a demo visitor", async ({ page, request }) => {
    const { hub } = await hubConfig(request);
    test.skip(hub.mode !== "demo", `localhost serves ${hub.id} in ${hub.mode ?? "env"} mode, not demo`);
    await freshVisitor(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
    await signUpToGate(page);
    const box = page.locator(".auth-legal-checkbox");
    await expect(box).toContainText("I'm trying this demo, and I have read and agree to the");
    await expect(box).not.toContainText("resident of");
  });

  test("signing up from a vote casts it, and the word cloud's Skip returns to it", async ({ page, request }) => {
    const { hub } = await hubConfig(request);
    test.skip(hub.mode !== "demo", `localhost serves ${hub.id} in ${hub.mode ?? "env"} mode, not demo`);
    const token = await adminSession(hub.id);
    const auth = { Authorization: `Bearer ${token}` };

    const keys = ["plugin.wordcloud.enabled", "plugin.wordcloud.onboarding_id", "plugin.vote.enabled"];
    const before = await Promise.all(keys.map(async (k) => [k, await storedSetting(hub.id, k)] as const));
    restore = async () => {
      const stored = before.filter(([, v]) => v !== undefined);
      if (stored.length) await putPlugins(request, token, Object.fromEntries(stored));
      // A key the hub had no row for goes back to having none.
      for (const [k, v] of before) {
        if (v === undefined) await localRest(`hub_settings?hub_id=eq.${hub.id}&key=eq.${k}`, { method: "DELETE" });
      }
    };
    await putPlugins(request, token, { "plugin.wordcloud.enabled": "true", "plugin.vote.enabled": "true" });

    const cloud = await request.post(`${API}/process`, {
      headers: auth,
      data: {
        definition: { type: "civic.wordcloud", version: "0.1" },
        title: `Onboarding cloud ${Date.now()}`,
        description: "Sign-up E2E.",
        state: { prompts: [{ id: "p1", text: "One word?" }] },
      },
    });
    expect(cloud.status(), await cloud.text()).toBe(201);
    const cloudBody = await cloud.json();
    await putPlugins(request, token, { "plugin.wordcloud.onboarding_id": cloudBody.id ?? cloudBody.process?.id });

    const title = `Sign-up keeps its place ${Date.now()}`;
    const vote = await request.post(`${API}/process`, {
      headers: auth,
      data: {
        definition: { type: "civic.vote", version: "0.1" },
        title,
        description: title,
        state: { options: ["Keep it", "Change it"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
      },
    });
    expect(vote.status(), await vote.text()).toBe(201);
    const voteBody = await vote.json();
    const voteId: string = voteBody.id ?? voteBody.process?.id;
    const act = await request.post(`${API}/process/${voteId}/action`, {
      headers: auth,
      data: { type: "process.activate", payload: {} },
    });
    expect(act.ok(), await act.text()).toBeTruthy();

    await freshVisitor(page);
    await page.goto(`/process/${voteId}`);
    await page.getByRole("button", { name: "Change it", exact: true }).click();
    await signUpToGate(page);
    await passGate(page);

    // Onboarding: the word cloud, carrying the vote's address.
    await expect(page).toHaveURL(/\/wordcloud\/.+onboarding=1.*return=/);
    await page.getByRole("button", { name: /Skip/ }).click();

    await expect(page).toHaveURL(new RegExp(`/process/${voteId}$`));
    await expect(page.getByText("Your vote has been recorded")).toBeVisible();
    await expect(page.locator(".vote-button.voted")).toHaveText("Change it");
  });
});
