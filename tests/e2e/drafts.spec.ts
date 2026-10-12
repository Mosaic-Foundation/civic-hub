/**
 * One drafting page for every kind (Audit 3, F1). A resident creates each of
 * the four kinds end to end through its own page: write the title and the
 * description, run the Code of Conduct check (the test servers have no AI key,
 * so it cannot run and the submission goes to an admin), submit, read the
 * confirmation, confirm, and land on the submission. The draft is one review
 * in the queue.
 *
 * Runs on whichever hub `localhost` resolves to, as a resident whose session
 * is written into the LOCAL stack (tests/fixtures/adminSession.ts).
 */

import { test, expect, type Page } from "@playwright/test";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";
import { E2E_API_BASE as API } from "./hubApi";

const run = Date.now().toString(36);

async function residentSession(hubId: string, n: number): Promise<string> {
  const email = `drafts-e2e-${run}-${n}@example.test`;
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

const KINDS = [
  { path: "/propose/new", api: "proposals", heading: "Propose something", confirm: "Submit your proposal", table: "proposal_drafts" },
  { path: "/votes/new", api: "votes", heading: "Suggest a vote", confirm: "Submit your vote", table: "vote_drafts" },
  { path: "/projects/new", api: "projects", heading: "Start a project", confirm: "Submit your project", table: "project_drafts" },
  { path: "/deliberations/new", api: "deliberations", heading: "Start a conversation", confirm: "Submit your conversation", table: "deliberation_drafts" },
];

for (const [n, kind] of KINDS.entries()) {
  test(`a resident creates a ${kind.api} draft end to end on the one drafting page`, async ({ page, request }) => {
    const { hub } = await (await request.get(`${API}/hub-config`)).json();
    await visitAs(page, await residentSession(hub.id, n));
    await page.goto(kind.path);
    await expect(page.getByRole("heading", { name: kind.heading })).toBeVisible();

    const title = `Drafts walk ${kind.api} ${run}`;
    await page.locator("#draft-title").fill(title);
    await page.locator("#draft-description").fill(`What this ${kind.api} draft is about.`);

    await page.getByRole("button", { name: "Run Code of Conduct check" }).click();
    await expect(page.getByText("Status: Ready to submit")).toBeVisible();

    await page.getByRole("button", { name: /Submit/ }).last().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: kind.confirm })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: title })).toBeVisible();
    await expect(dialog.getByText(/submitted for review before going live|goes live right away/)).toBeVisible();

    const submitted = page.waitForResponse((r) => new RegExp(`/${kind.api}/drafts/[^/]+/submit$`).test(r.url()));
    await dialog.getByRole("button", { name: /Submit/ }).click();
    const res = await submitted;
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { review_id: string; auto_approved: boolean };
    if (!body.auto_approved) await expect(page).toHaveURL(new RegExp(`/my-submissions/${body.review_id}`));

    const draftId = new URL(res.url()).pathname.split("/").at(-2)!;
    const reviews = (await localRest(`process_reviews?select=id&draft_id=eq.${draftId}`)) as unknown[];
    expect(reviews).toHaveLength(1);
  });
}
