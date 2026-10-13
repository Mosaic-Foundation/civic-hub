/**
 * Submit runs the Code of Conduct check (Submit and Save, 2026-10-12), as a
 * resident sees it. There is no separate check button:
 *   - flagged text: Submit is refused, nothing is submitted, the draft is
 *     kept, and the resident sees what to fix, in a list above the form and
 *     under the field itself;
 *   - "Think this is wrong? Tell the admins" sends it to the review queue,
 *     flagged, with the resident's note, once;
 *   - fixed text: Submit goes through.
 * The test hub runs the fake check (CIVIC_COC_FAKE=on): it flags text with
 * [coc-flag] in it.
 *
 * Runs on whichever hub `localhost` resolves to, as a resident whose session
 * is written into the LOCAL stack (tests/fixtures/adminSession.ts).
 */

import { test, expect, type Page } from "@playwright/test";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { FAKE_COC_FLAG as COC_FLAG } from "../../src/debug/fakeCodeOfConduct.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";
import { E2E_API_BASE as API } from "./hubApi";

const run = Date.now().toString(36);

async function residentSession(hubId: string, n: number): Promise<string> {
  const email = `coc-e2e-${run}-${n}@example.test`;
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

/** Write a proposal whose description the check flags, and press Submit, then the preview's Submit. */
async function submitFlagged(page: Page, title: string) {
  await page.goto("/propose/new");
  await page.locator("#draft-title").fill(title);
  // Submit straight after typing: what is on screen is what gets checked.
  await page.locator("#draft-description").fill(`Two benches by the door. ${COC_FLAG}`);
  await page.getByRole("button", { name: "Submit proposal" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Submit your proposal" })).toBeVisible();
  await expect(dialog.getByText(title)).toBeVisible();
  const answered = page.waitForResponse((r) => /\/proposals\/drafts\/[^/]+\/submit$/.test(r.url()));
  await dialog.getByRole("button", { name: /^Submit/ }).click();
  return answered;
}

test("Submit with flagged text: refused, the draft kept, and what to fix shown by the text", async ({ page, request }) => {
  const { hub } = await (await request.get(`${API}/hub-config`)).json();
  await visitAs(page, await residentSession(hub.id, 1));
  const title = `Flagged walk ${run}`;

  const res = await submitFlagged(page, title);
  expect(res.status()).toBe(400);
  expect((await res.json()).code).toBe("code_of_conduct_flagged");

  // Nothing submitted: still on the form, with the text as typed.
  await expect(page).toHaveURL(/\/propose\/new/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#draft-title")).toHaveValue(title);
  const panel = page.getByRole("region", { name: "Change this before submitting" });
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();
  // Under the field in question.
  await expect(page.locator(".field-finding")).toContainText("Code of Conduct");
  await expect(page.getByText("Change what the check flagged, then press Submit again.")).toBeVisible();

  // Fixed, and submitted.
  await page.locator("#draft-description").fill("Two benches by the door.");
  await page.getByRole("button", { name: "Submit proposal" }).click();
  const ok = page.waitForResponse((r) => /\/proposals\/drafts\/[^/]+\/submit$/.test(r.url()));
  await page.getByRole("dialog").getByRole("button", { name: /^Submit/ }).click();
  expect((await ok).status()).toBe(201);
});

test("'Tell the admins' sends the flagged text to the review queue once, with the note", async ({ page, request }) => {
  const { hub } = await (await request.get(`${API}/hub-config`)).json();
  await visitAs(page, await residentSession(hub.id, 2));
  const res = await submitFlagged(page, `Tell the admins ${run}`);
  expect(res.status()).toBe(400);
  const draftId = new URL(res.url()).pathname.split("/").at(-2)!;

  await page.getByRole("button", { name: "Tell the admins" }).click();
  const dialog = page.getByRole("dialog", { name: "Tell the admins" });
  await expect(dialog).toBeVisible();
  // The note field has focus: the person can type straight away.
  const note = dialog.getByLabel(/A note for the admins/);
  await expect(note).toBeFocused();
  await note.fill("It's a quotation from the notice.");

  const sent = page.waitForResponse((r) => /\/proposals\/drafts\/[^/]+\/submit$/.test(r.url()));
  await dialog.getByRole("button", { name: "Send to the admins" }).click();
  const body = await (await sent).json();
  expect(body).toMatchObject({ flagged: true, auto_approved: false });
  await expect(page).toHaveURL(new RegExp(`/my-submissions/${body.review_id}`));
  await expect(page.getByText(/Sent to the admins, with what the Code of Conduct check flagged/)).toBeVisible();

  const reviews = (await localRest(`process_reviews?select=id,status,coc_flags&draft_id=eq.${draftId}`)) as Array<{
    status: string;
    coc_flags: unknown[] | null;
  }>;
  expect(reviews).toHaveLength(1);
  expect(reviews[0].status).toBe("pending_review");
  expect(reviews[0].coc_flags?.length).toBeGreaterThan(0);
});

test("Escape closes 'Tell the admins' without sending, and focus goes back", async ({ page, request }) => {
  const { hub } = await (await request.get(`${API}/hub-config`)).json();
  await visitAs(page, await residentSession(hub.id, 3));
  await submitFlagged(page, `Escape ${run}`);
  const open = page.getByRole("button", { name: "Tell the admins" });
  await open.click();
  await expect(page.getByRole("dialog", { name: "Tell the admins" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(open).toBeFocused();
});
