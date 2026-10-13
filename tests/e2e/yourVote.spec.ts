/**
 * "Your vote" and the results (Actions slice, 2026-10-13), at desktop and
 * phone width.
 *
 * - The resident's own option carries "✓ Your vote" on the results bars,
 *   from the receipt their browser holds (the server keeps no link from a
 *   person to a ballot): after voting, after a reload, and after the vote
 *   closes. Another resident's browser marks nothing.
 * - Labels sit above their bars at full width; a label longer than the
 *   option limit (an older vote) shows three lines and the rest on a tap.
 * - A page read again when its tab comes back into view: a vote cast in
 *   another tab shows up in the tally without a reload.
 */

import { test, expect, type Page } from "@playwright/test";
import { localRest } from "../fixtures/adminSession.js";
import { adminEmailFor, closeAsAdmin, hubId, liveVote, run, session, visitAs } from "./actors";

const row = (page: Page, option: string) => page.locator(".tally-row", { has: page.locator(".tally-label-text", { hasText: option }) });

for (const width of [1280, 375]) {
  test.describe(`Your vote at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    let hub = "";
    let admin = "";

    test.beforeAll(async ({ request }) => {
      hub = await hubId(request);
      admin = (await session(hub, adminEmailFor(hub))).token;
    });

    test("the voter's option is marked on the results, open and closed; nobody else's browser marks it", async ({ page, request, browser }) => {
      const voteId = await liveVote(request, admin, `Your vote ${width} ${run}`);
      const voter = await session(hub, `your-vote-${width}-${run}@example.test`);
      await visitAs(page, voter.token);
      await page.goto(`/process/${voteId}`);
      await page.locator(".vote-buttons button", { hasText: "No" }).click();

      await expect(row(page, "No").locator(".result-mine")).toHaveText("✓ Your vote");
      await expect(row(page, "Yes").locator(".result-mine")).toHaveCount(0);
      // The label is above its bar, as wide as the bar.
      const label = await row(page, "No").locator(".tally-label").boundingBox();
      const track = await row(page, "No").locator(".tally-bar-track").boundingBox();
      expect(label!.y + label!.height).toBeLessThanOrEqual(track!.y + 1);

      await page.reload();
      await expect(row(page, "No").locator(".result-mine")).toBeVisible();

      // Closed: the results keep the mark.
      await closeAsAdmin(request, admin, voteId);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Voting finalized" })).toBeVisible();
      await expect(row(page, "No").locator(".result-mine")).toHaveText("✓ Your vote");

      // Another resident's browser holds no receipt for it: no mark.
      const other = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const theirs = await other.newPage();
        await visitAs(theirs, (await session(hub, `your-vote-other-${width}-${run}@example.test`)).token);
        await theirs.goto(`/process/${voteId}`);
        await expect(row(theirs, "No")).toBeVisible();
        await expect(theirs.locator(".result-mine")).toHaveCount(0);
      } finally {
        await other.close();
      }
    });

    test("an older vote's long option shows three lines, and the rest on a tap", async ({ page, request }) => {
      const voteId = await liveVote(request, admin, `Long option ${width} ${run}`, {
        method: "approval",
        options: ["Short option", "Another option"],
      });
      // Written straight to the row: votes made today can't have one this long.
      const long = `A very long option written before the limit existed ${"and it keeps going ".repeat(40)}until the end.`;
      const [current] = (await localRest(`processes?select=state&id=eq.${voteId}`)) as Array<{ state: Record<string, unknown> }>;
      await localRest(`processes?id=eq.${voteId}`, {
        method: "PATCH",
        body: JSON.stringify({ state: { ...current.state, options: ["Short option", long] } }),
      });
      await closeAsAdmin(request, admin, voteId);

      await visitAs(page, (await session(hub, `long-option-${width}-${run}@example.test`)).token);
      await page.goto(`/process/${voteId}`);
      const button = page.locator(".tally-label-long");
      await expect(button).toHaveAttribute("aria-expanded", "false");
      const lineHeight = await button.evaluate((b) => parseFloat(getComputedStyle(b).lineHeight) || 20);
      const closed = (await button.boundingBox())!.height;
      expect(closed).toBeLessThanOrEqual(lineHeight * 3 + 2);
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      expect((await button.boundingBox())!.height).toBeGreaterThan(closed);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });

    test("back in view, the page reads the vote again: another tab's ballot shows", async ({ page, request }) => {
      const voteId = await liveVote(request, admin, `Tab refresh ${width} ${run}`);
      const me = await session(hub, `tab-refresh-${width}-${run}@example.test`);
      await page.clock.install();
      await visitAs(page, me.token);
      await page.goto(`/process/${voteId}`);
      await page.locator(".vote-buttons button", { hasText: "Yes" }).click();
      await expect(row(page, "Yes")).toContainText("1 (100%)");

      // Someone else votes; this tab is in the background meanwhile.
      const someone = await session(hub, `tab-refresh-other-${width}-${run}@example.test`);
      const cast = await request.post(`${process.env.CIVIC_E2E_API_BASE?.trim() || "http://localhost:3000"}/process/${voteId}/action`, {
        headers: { Authorization: `Bearer ${someone.token}` },
        data: { type: "process.vote", payload: { option: "No" } },
      });
      expect(cast.ok(), await cast.text()).toBeTruthy();

      await page.clock.fastForward(20_000);
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(row(page, "No")).toContainText("1 (50%)");
      await expect(row(page, "Yes").locator(".result-mine")).toBeVisible();
      await closeAsAdmin(request, admin, voteId);
    });
  });
}
