/**
 * The frontend pass (2026-10-24): one data hook, one token store, one modal.
 *
 *   - Fast navigation between two detail pages never shows the first page's
 *     record under the second's address (the stale response Process.tsx and
 *     ProposalDetail.tsx used to paint).
 *   - With storage blocked, the app still renders, signed out.
 */

import { test, expect, type Page } from "@playwright/test";
import { adminEmailFor, hubId, liveProposal, liveVote, run, session, visitAs } from "./actors";

/** Client-side navigation, as a link click does it: no reload, the router only. */
async function goClientSide(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    window.history.pushState({}, "", p);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

test.describe("a slow answer for a page already left", () => {
  test("a vote page shows the vote at its address, never the one before it", async ({ page, request }) => {
    const hub = await hubId(request);
    const admin = await session(hub, adminEmailFor(hub));
    const slowTitle = `Stale A ${run}`;
    const fastTitle = `Stale B ${run}`;
    const slow = await liveVote(request, admin.token, slowTitle);
    const fast = await liveVote(request, admin.token, fastTitle);
    await visitAs(page, admin.token);

    await page.goto(`/process/${fast}`);
    await expect(page.getByRole("heading", { name: fastTitle })).toBeVisible();

    // A's state answers two seconds late; meanwhile the reader goes back to B.
    let released = false;
    await page.route(`**/process/${slow}/state`, async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      released = true;
      await route.continue();
    });
    await goClientSide(page, `/process/${slow}`);
    await goClientSide(page, `/process/${fast}`);
    await expect(page.getByRole("heading", { name: fastTitle })).toBeVisible();
    await expect.poll(() => released, { timeout: 5000 }).toBe(true);
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(new RegExp(`/process/${fast}$`));
    await expect(page.getByRole("heading", { name: fastTitle })).toBeVisible();
    await expect(page.getByRole("heading", { name: slowTitle })).toHaveCount(0);
  });

  test("a proposal page likewise", async ({ page, request }) => {
    const hub = await hubId(request);
    const admin = await session(hub, adminEmailFor(hub));
    const creator = await session(hub, `stale-${run}@example.test`);
    const slowTitle = `Stale proposal A ${run}`;
    const fastTitle = `Stale proposal B ${run}`;
    const slow = await liveProposal(request, creator.token, admin.token, slowTitle);
    const fast = await liveProposal(request, creator.token, admin.token, fastTitle);
    await visitAs(page, admin.token);

    await page.goto(`/proposal/${fast}`);
    await expect(page.getByRole("heading", { name: fastTitle })).toBeVisible();

    let released = false;
    await page.route(`**/proposals/${slow}`, async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      released = true;
      await route.continue();
    });
    await goClientSide(page, `/proposal/${slow}`);
    await goClientSide(page, `/proposal/${fast}`);
    await expect.poll(() => released, { timeout: 5000 }).toBe(true);
    await page.waitForTimeout(500);
    await expect(page.getByRole("heading", { name: fastTitle })).toBeVisible();
    await expect(page.getByRole("heading", { name: slowTitle })).toHaveCount(0);
  });
});

test.describe("blocked storage", () => {
  test("the app renders signed out, and an admin page asks for a sign-in instead of staying blank", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      // As a browser with site data blocked: every access throws.
      const blocked = () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      };
      for (const name of ["localStorage", "sessionStorage"] as const) {
        Object.defineProperty(window, name, { configurable: true, get: blocked });
      }
    });
    await page.goto("/");
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" }).first()).toBeVisible();

    // AdminGuard asks for a sign-in rather than leaving the page blank.
    await page.goto("/admin/reviews");
    await expect(page.getByRole("dialog", { name: /Sign in/ })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    expect(errors).toEqual([]);
  });
});
