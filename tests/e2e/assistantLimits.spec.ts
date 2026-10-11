/**
 * Audit 2, A6 (2026-10-11): when the server refuses an assistant call for a
 * limit, the chat shows the server's own words, not "Something went wrong"
 * (Adam, dev check: a per-hour limit of 2 showed the generic error).
 *
 * The message-length cap is the limit used here: it answers before any model
 * call, so the test needs no AI key and spends nothing. The per-hour count and
 * the spent budget come back through the same path with their own codes
 * (tests/api/aiLimits.test.ts).
 */

import { test, expect } from "@playwright/test";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";
import { E2E_API_BASE as API } from "./hubApi";
import { consoleCall, mintConsoleSession } from "../fixtures/consoleCall.js";

async function residentOn(page: import("@playwright/test").Page, hubId: string, tag: string): Promise<void> {
  const email = `${tag}-${Date.now()}@example.test`;
  const token = await mintSession(hubId, email);
  await localRest(`users?hub_id=eq.${hubId}&email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ tos_version_accepted: CURRENT_LEGAL_VERSION }),
  });
  await page.addInitScript((t) => {
    localStorage.setItem("seen_intro_popup", "true");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
    sessionStorage.setItem("civic_preview", "1");
    localStorage.setItem("civic_auth_token", t);
  }, token);
}

test("a refused message shows the server's reason in the chat", async ({ page, request }) => {
  const { hub } = await (await request.get(`${API}/hub-config`)).json();
  const email = `chat-limit-e2e-${Date.now()}@example.test`;
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

  await page.goto("/votes/new");
  await page.getByRole("button", { name: "Open the assistant" }).click();
  const box = page.getByPlaceholder(/Type your answer here|Ask for help with your draft/);
  await expect(box).toBeVisible();
  await box.fill("x".repeat(4001));
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect(page.getByText(/That message is too long for the assistant/)).toBeVisible();
  await expect(page.getByText("Something went wrong with the assistant")).toHaveCount(0);
});

test("over the hourly limit, the chat says to wait a while", async ({ page, request }) => {
  const { hub } = await (await request.get(`${API}/hub-config`)).json();
  // The operator sets one turn an hour for this hub, from the console.
  const cookie = await mintConsoleSession();
  const set = await consoleCall("PUT", `/control/hubs/${hub.id}/ai-limits`, { cookie, body: { user_per_hour: 1 } });
  expect(set.status, JSON.stringify(set.body)).toBe(200);
  try {
    await residentOn(page, hub.id, "chat-hourly-e2e");
    await page.goto("/votes/new");
    await page.getByRole("button", { name: "Open the assistant" }).click();
    // Opening the assistant is a turn: it asks the model for its first
    // question (with no AI key here, that call fails after being counted).
    await expect(page.getByText(/isn't configured yet/)).toBeVisible();
    // So the person's first message is the second turn, and is refused, in
    // the server's words.
    const box = page.getByPlaceholder(/Type your answer here|Ask for help with your draft/);
    await box.fill("I'd like to gauge interest in a community garden.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("You've asked the assistant a lot in a short time. Please wait a while and try again.")).toBeVisible();
    await expect(page.getByText("Something went wrong with the assistant")).toHaveCount(0);
  } finally {
    await consoleCall("PUT", `/control/hubs/${hub.id}/ai-limits`, { cookie, body: { user_per_hour: null } });
  }
});
