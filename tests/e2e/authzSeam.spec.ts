/**
 * The authorization seam, end to end (Architecture 4, ADR-011): who may do
 * what is decided by the account, and nobody's access changed.
 *
 *   1. Someone the admin list names who has never signed in: their first
 *      sign-in (a real emailed code) and joining make them an admin at once
 *      (their pending grant binds to the new account in the same request):
 *      they land on "Next: set up your hub", as a new admin does, /auth/me
 *      says admin, and they close a vote early from its page.
 *   2. A resident takes part (votes), has no Close early button, and the
 *      server refuses the close with admin_required; the vote stays open.
 *   3. Signed out: the action is refused with sign_in_required.
 *
 * On whichever hub `localhost` resolves to (Athens, a demo, on the local
 * stack). The admin list is changed for test 1 and put back.
 */

import { test, expect, type Page } from "@playwright/test";
import { localRest, plantHubCode } from "../fixtures/adminSession.js";
import { adminEmailFor, closeAsAdmin, hubId, liveVote, run, session, visitAs } from "./actors";
import { E2E_API_BASE as API } from "./hubApi";

async function freshVisitor(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("seen_intro_popup", "true");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
    sessionStorage.setItem("civic_preview", "1");
  });
}

test.use({ viewport: { width: 1280, height: 900 } });

test.describe("The seam: sign-in, joining, an admin's action, a resident refused", () => {
  let hub = "";
  let admin = "";
  let voteId = "";

  test.beforeAll(async ({ request }) => {
    hub = await hubId(request);
    admin = (await session(hub, adminEmailFor(hub))).token;
  });

  test.afterAll(async ({ request }) => {
    if (voteId) await closeAsAdmin(request, admin, voteId);
  });

  test("1. a listed admin's first sign-in and join make them an admin at once; they close a vote early", async ({ page, request }) => {
    const email = `first-admin-${run}@example.test`;
    const key = `hub_settings?hub_id=eq.${hub}&key=eq.people.admin_emails`;
    const [row] = (await localRest(`${key}&select=value`)) as Array<{ value: string }>;
    const before = row.value;
    await localRest(key, { method: "PATCH", body: JSON.stringify({ value: JSON.stringify([...JSON.parse(before), email]) }) });
    try {
      voteId = await liveVote(request, admin, `Seam vote ${run}`);
      await plantHubCode(hub, email, "352461");

      await freshVisitor(page);
      await page.goto("/");
      await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
      await page.getByPlaceholder("you@example.com").fill(email);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.locator("#auth-code").fill("352461");
      await page.getByRole("button", { name: "Verify", exact: true }).click();
      const join = page.getByRole("button", { name: "Join", exact: true });
      await expect(join).toBeVisible();
      await page.getByPlaceholder("Jane Doe").fill("First Admin");
      // A demo's sign-in asks for the residency box; a real-code one may not.
      const box = page.locator(".auth-legal-checkbox input[type=checkbox]");
      if (await box.count()) await box.check();
      await join.click();
      await expect(join).toHaveCount(0);

      // The account the sign-in just created is an admin, by its grant: a new
      // admin's first join lands on "Next: set up your hub", and /auth/me says so.
      await expect(page).toHaveURL(/\/admin\/settings\/sample#next-steps$/);
      const token = await (await page.waitForFunction(() => localStorage.getItem("civic_auth_token"))).jsonValue();
      const me = await (await request.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
      expect(me.role).toBe("admin");

      // An admin's action, from the page.
      await page.goto(`/process/${voteId}`);
      await page.getByRole("button", { name: "Close early" }).click();
      const dialog = page.getByRole("dialog", { name: "Close this vote early?" });
      await dialog.getByLabel(/Why is it closing early/).fill("Settled at the meeting (seam test).");
      await dialog.getByRole("button", { name: "Close the vote now" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.locator(".closed-early-note")).toContainText("Admin note: Settled at the meeting (seam test).");
    } finally {
      await localRest(key, { method: "PATCH", body: JSON.stringify({ value: before }) });
    }
  });

  test("2. a resident votes, has no Close early, and the server refuses the close", async ({ page, request }) => {
    const id = await liveVote(request, admin, `Seam resident vote ${run}`);
    try {
      const resident = await session(hub, `seam-resident-${run}@example.test`);
      const auth = { Authorization: `Bearer ${resident.token}` };
      const voted = await request.post(`${API}/process/${id}/action`, { headers: auth, data: { type: "process.vote", payload: { option: "Yes" } } });
      expect(voted.ok()).toBe(true);

      await visitAs(page, resident.token);
      await page.goto(`/process/${id}`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(`Seam resident vote ${run}`);
      await expect(page.getByRole("button", { name: "Close early" })).toHaveCount(0);

      const refused = await request.post(`${API}/process/${id}/action`, {
        headers: auth,
        data: { type: "process.close", payload: { note: "A resident trying to close it." } },
      });
      expect(refused.status()).toBe(403);
      expect((await refused.json()).code).toBe("admin_required");
      const state = await (await request.get(`${API}/process/${id}/state`, { headers: auth })).json();
      expect(state.status).toBe("active");
    } finally {
      await closeAsAdmin(request, admin, id);
    }
  });

  test("3. signed out, an action is refused before anything is looked up", async ({ request }) => {
    const id = await liveVote(request, admin, `Seam signed-out vote ${run}`);
    try {
      const refused = await request.post(`${API}/process/${id}/action`, { data: { type: "process.vote", payload: { option: "Yes" } } });
      expect(refused.status()).toBe(401);
      expect((await refused.json()).code).toBe("sign_in_required");
    } finally {
      await closeAsAdmin(request, admin, id);
    }
  });
});
