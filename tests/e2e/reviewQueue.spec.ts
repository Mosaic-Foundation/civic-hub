/**
 * After an admin approves or declines in the review queue, they land back on
 * the list with a short confirmation, not on the item (Submit and Save,
 * 2026-10-12).
 *
 * A resident's proposal is put in the queue the way a resident puts one
 * there: a draft and a Submit whose Code of Conduct check can't run (the test
 * hub's fake check is down on [coc-down]), so even a demo hub holds it for an
 * admin. Runs on whichever hub `localhost` resolves to.
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { FAKE_COC_DOWN } from "../../src/debug/fakeCodeOfConduct.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";
import { E2E_API_BASE as API } from "./hubApi";

const run = Date.now().toString(36);

async function session(hubId: string, email: string): Promise<string> {
  const token = await mintSession(hubId, email);
  await localRest(`users?hub_id=eq.${hubId}&email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ tos_version_accepted: CURRENT_LEGAL_VERSION }),
  });
  return token;
}

async function pendingReview(request: APIRequestContext, token: string, title: string): Promise<string> {
  const headers = { Authorization: `Bearer ${token}` };
  const draft = await (await request.post(`${API}/proposals/drafts`, { headers, data: { category: "idea" } })).json();
  await request.patch(`${API}/proposals/drafts/${draft.id}`, {
    headers,
    data: { title, description: `Waiting for an admin. ${FAKE_COC_DOWN}` },
  });
  const res = await request.post(`${API}/proposals/drafts/${draft.id}/submit`, { headers, data: {} });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.auto_approved).toBe(false);
  return body.review_id as string;
}

async function visitAs(page: Page, token: string) {
  await page.addInitScript((t) => {
    localStorage.setItem("seen_intro_popup", "true");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
    sessionStorage.setItem("civic_preview", "1");
    localStorage.setItem("civic_auth_token", t);
  }, token);
}

async function adminSession(request: APIRequestContext): Promise<{ hubId: string; admin: string; resident: string }> {
  const { hub } = await (await request.get(`${API}/hub-config`)).json();
  // The local stack's admin of this hub (supabase/seed.sql): admin@ on Floyd, admin+<hub>@ elsewhere.
  const adminEmail = hub.id === "floyd" ? "admin@example.test" : `admin+${hub.id}@example.test`;
  return {
    hubId: hub.id,
    admin: await session(hub.id, adminEmail),
    resident: await session(hub.id, `queue-e2e-${run}@example.test`),
  };
}

test("approving lands back on the list, with a confirmation", async ({ page, request }) => {
  const { admin, resident } = await adminSession(request);
  const title = `Approve and back ${run}`;
  const reviewId = await pendingReview(request, resident, title);

  await visitAs(page, admin);
  await page.goto(`/admin/reviews/${reviewId}`);
  await page.getByRole("button", { name: "Approve & post" }).click();

  await expect(page).toHaveURL(/\/admin\/reviews$/);
  await expect(page.getByRole("heading", { name: "Process reviews" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: `Approved: “${title}” is live.` })).toBeVisible();
});

test("declining lands back on the list, with a confirmation", async ({ page, request }) => {
  const { admin, resident } = await adminSession(request);
  const title = `Decline and back ${run}`;
  const reviewId = await pendingReview(request, resident, title);

  await visitAs(page, admin);
  await page.goto(`/admin/reviews/${reviewId}`);
  await page.getByRole("button", { name: "Decline" }).click();
  await page.getByPlaceholder("Reason for declining").fill("Out of scope for this hub.");
  await page.getByRole("button", { name: /Decline/ }).last().click();

  await expect(page).toHaveURL(/\/admin\/reviews$/);
  await expect(page.getByRole("status").filter({ hasText: `Declined: “${title}”.` })).toBeVisible();
});
