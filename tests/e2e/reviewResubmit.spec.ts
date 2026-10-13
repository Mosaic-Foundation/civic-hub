/**
 * "Edit & resubmit" on a submission whose changes were requested (Audit 3
 * checklist step 3), for a submission sent in flagged ("Tell the admins")
 * and for an ordinary one, on a project and a vote.
 *
 * The regression (dev, 2026-10-12): arriving on My submissions straight from
 * a submit shows a confirmation that hid every action, and the browser kept
 * it across reloads, so a resident who stayed on that tab never saw "Edit &
 * resubmit" after the admin asked for changes. The resident here stays on
 * that tab and reloads, as Adam did.
 *
 * The hub runs the fake check (CIVIC_COC_FAKE=on): [coc-flag] is flagged,
 * [coc-down] makes the check unavailable, so the submission waits for an
 * admin even on a demo hub. Runs on whichever hub `localhost` resolves to.
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { FAKE_COC_DOWN, FAKE_COC_FLAG } from "../../src/debug/fakeCodeOfConduct.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";
import { E2E_API_BASE as API } from "./hubApi";

const run = Date.now().toString(36);

const KINDS = [
  { name: "project", path: "/projects/new", submit: "Submit project", confirm: "Submit your project" },
  { name: "vote", path: "/votes/new", submit: "Submit vote", confirm: "Submit your vote" },
];

async function session(hubId: string, email: string): Promise<string> {
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

async function requestChanges(request: APIRequestContext, adminToken: string, reviewId: string) {
  const res = await request.post(`${API}/admin/reviews/${reviewId}/request-changes`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { note: "Please say who will run it." },
  });
  expect(res.status()).toBe(200);
}

async function reviewRow(reviewId: string) {
  const [row] = (await localRest(`process_reviews?select=id,status,coc_flags,draft_id&id=eq.${reviewId}`)) as Array<{
    id: string;
    status: string;
    coc_flags: unknown[] | null;
    draft_id: string;
  }>;
  return row;
}

/** Write a draft and press Submit, then the preview's Submit. Returns the submit response. */
async function writeAndSubmit(page: Page, kind: (typeof KINDS)[number], title: string, description: string) {
  await page.goto(kind.path);
  await page.locator("#draft-title").fill(title);
  await page.locator("#draft-description").fill(description);
  await page.getByRole("button", { name: kind.submit }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: kind.confirm })).toBeVisible();
  const answered = page.waitForResponse((r) => /\/drafts\/[^/]+\/submit$/.test(r.url()));
  await dialog.getByRole("button", { name: /^Submit/ }).click();
  return answered;
}

/** After the admin asked for changes, on the tab the resident landed on: the page and its actions. */
async function expectChangesRequestedPage(page: Page) {
  await page.reload();
  await expect(page.getByText("Changes requested").first()).toBeVisible();
  await expect(page.getByText("Please say who will run it.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit & resubmit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Withdraw" })).toBeVisible();
  // The arrival note is gone: the review isn't waiting any more.
  await expect(page.getByText(/^Sent to the admins|^Submitted/)).toHaveCount(0);
}

for (const [n, kind] of KINDS.entries()) {
  test(`${kind.name} sent in flagged: changes requested, edit, resubmit, the same item back in the queue`, async ({ page, request }) => {
    const { hub } = await (await request.get(`${API}/hub-config`)).json();
    const admin = await session(hub.id, hub.id === "floyd" ? "admin@example.test" : `admin+${hub.id}@example.test`);
    await visitAs(page, await session(hub.id, `resubmit-e2e-${run}-${n}a@example.test`));

    const title = `Resubmit flagged ${kind.name} ${run}`;
    expect((await writeAndSubmit(page, kind, title, `Lend tools. ${FAKE_COC_FLAG}`)).status()).toBe(400);
    await page.getByRole("button", { name: "Tell the admins" }).click();
    const sent = page.waitForResponse((r) => /\/drafts\/[^/]+\/submit$/.test(r.url()));
    await page.getByRole("dialog", { name: "Tell the admins" }).getByRole("button", { name: "Send to the admins" }).click();
    const { review_id: reviewId } = await (await sent).json();
    await expect(page).toHaveURL(new RegExp(`/my-submissions/${reviewId}`));
    expect((await reviewRow(reviewId)).coc_flags?.length).toBeGreaterThan(0);

    await requestChanges(request, admin, reviewId);
    await expectChangesRequestedPage(page);

    // Edit & resubmit opens the real drafting form for this review.
    await page.getByRole("button", { name: "Edit & resubmit" }).click();
    await expect(page).toHaveURL(new RegExp(`review=${reviewId}`));
    await expect(page.locator("#draft-title")).toHaveValue(title);
    await page.locator("#draft-description").fill("Lend tools, run by the library volunteers.");
    await page.getByRole("button", { name: kind.submit }).click();
    const resubmitted = page.waitForResponse((r) => /\/drafts\/[^/]+\/submit$/.test(r.url()));
    await page.getByRole("dialog").getByRole("button", { name: /^Submit/ }).click();
    const body = await (await resubmitted).json();

    // The same item, back in the queue, no longer flagged (the new text passed).
    expect(body.review_id).toBe(reviewId);
    const row = await reviewRow(reviewId);
    expect(row.status).toBe("pending_review");
    expect(row.coc_flags).toBeNull();
    const all = (await localRest(`process_reviews?select=id&draft_id=eq.${row.draft_id}`)) as unknown[];
    expect(all).toHaveLength(1);
    await expect(page).toHaveURL(new RegExp(`/my-submissions/${reviewId}`));
  });

  test(`${kind.name} submitted the ordinary way: the same page after changes are requested`, async ({ page, request }) => {
    const { hub } = await (await request.get(`${API}/hub-config`)).json();
    const admin = await session(hub.id, hub.id === "floyd" ? "admin@example.test" : `admin+${hub.id}@example.test`);
    await visitAs(page, await session(hub.id, `resubmit-e2e-${run}-${n}b@example.test`));

    // The check down: it waits for an admin on any hub.
    const res = await writeAndSubmit(page, kind, `Resubmit ordinary ${kind.name} ${run}`, `Lend tools. ${FAKE_COC_DOWN}`);
    expect(res.status()).toBe(201);
    const { review_id: reviewId } = await res.json();
    await expect(page).toHaveURL(new RegExp(`/my-submissions/${reviewId}`));

    await requestChanges(request, admin, reviewId);
    await expectChangesRequestedPage(page);
  });
}
