/**
 * The vote pages, tidied (Vote pages fixes, 2026-10-13, from Adam's dev
 * walk of the Actions slice), at desktop and phone width:
 *
 * - voting never moves the page: the voter stays on the results and the
 *   receipt, and the share nudge is a 5-second banner at the bottom of the
 *   screen (or the bar's own callout when the bar is in view);
 * - a blank option field never blocks Submit: empty fields are dropped, and
 *   two filled options are enough.
 */

import { test, expect } from "@playwright/test";
import { adminEmailFor, closeAsAdmin, hubId, liveVote, run, session, visitAs } from "./actors";

for (const width of [1280, 375]) {
  test.describe(`Vote pages at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    let hub = "";
    let admin = "";

    test.beforeAll(async ({ request }) => {
      hub = await hubId(request);
      admin = (await session(hub, adminEmailFor(hub))).token;
    });

    test("voting doesn't move the page; the share nudge is a banner that goes by itself", async ({ page, request }) => {
      const voteId = await liveVote(request, admin, `No scroll ${width} ${run}`);
      await visitAs(page, (await session(hub, `no-scroll-${width}-${run}@example.test`)).token);
      // A short window, so the ballot sits below the share bar at both widths.
      await page.setViewportSize({ width, height: 560 });
      await page.goto(`/process/${voteId}`);
      const no = page.getByRole("button", { name: "No", exact: true });
      await no.evaluate((b) => b.scrollIntoView({ block: "start" }));
      // What the voter sees: where the ballot sits on the screen. (The
      // comment field above it folds away after a vote; the browser keeps the
      // ballot where it was, which is the point.)
      const ballot = page.locator(".vote-buttons");
      const onScreen = async () => (await ballot.boundingBox())!.y;
      const before = await onScreen();
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await no.click();
      await expect(page.locator(".vote-receipt")).toBeVisible();
      const nudge = page.locator(".share-banner, .share-callout");
      await expect(nudge).toContainText("share this");
      expect(Math.abs((await onScreen()) - before)).toBeLessThanOrEqual(2);
      // The banner (or callout) goes by itself; the page still hasn't moved.
      await expect(nudge).toHaveCount(0, { timeout: 8_000 });
      expect(Math.abs((await onScreen()) - before)).toBeLessThanOrEqual(2);
      await closeAsAdmin(request, admin, voteId);
    });

    test("an empty extra option field doesn't block Submit, and the vote gets the filled ones", async ({ page }) => {
      await visitAs(page, (await session(hub, `blank-option-${width}-${run}@example.test`)).token);
      await page.goto("/votes/new");
      await page.getByRole("button", { name: "Approval (pick from options)" }).click();
      const title = `Blank option ${width} ${run}`;
      await page.locator("#draft-title").fill(title);
      await page.locator("#draft-description").fill("A vote with an extra option field left empty.");
      await page.getByRole("textbox", { name: "Option 1" }).fill("Paint it green");
      await page.getByRole("textbox", { name: "Option 2" }).fill("Paint it blue");
      await page.getByRole("button", { name: "+ Add option" }).click();
      await expect(page.getByRole("textbox", { name: "Option 3" })).toHaveValue("");

      await page.getByRole("textbox", { name: "Option 3" }).blur();
      await expect(page.getByText("Every option needs text")).toHaveCount(0);
      const submit = page.getByRole("button", { name: "Submit vote" }).last();
      await expect(submit).toBeEnabled();
      await submit.click();
      const dialog = page.getByRole("dialog");
      const submitted = page.waitForResponse((r) => /\/votes\/drafts\/[^/]+\/submit$/.test(r.url()));
      await dialog.getByRole("button", { name: /Submit/ }).click();
      expect((await submitted).status()).toBe(201);
    });

    test("one filled option says two are needed", async ({ page }) => {
      await visitAs(page, (await session(hub, `one-option-${width}-${run}@example.test`)).token);
      await page.goto("/votes/new");
      await page.getByRole("button", { name: "Approval (pick from options)" }).click();
      await page.locator("#draft-title").fill(`One option ${width} ${run}`);
      await page.getByRole("textbox", { name: "Option 1" }).fill("Only this");
      await page.getByRole("textbox", { name: "Option 1" }).blur();
      await expect(page.getByText("Approval voting needs at least 2 options.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Submit vote" }).last()).toBeDisabled();
    });
  });
}
