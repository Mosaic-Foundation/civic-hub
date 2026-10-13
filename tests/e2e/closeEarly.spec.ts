/**
 * Close early (Actions slice, 2026-10-13), on a vote and on a proposal, at
 * desktop and phone width.
 *
 * An admin opens Close early; the close can't be confirmed until there is a
 * note; with one, the page shows the process closed, "Closed early on …"
 * and the admin's note, without a reload. A resident sees no Close early
 * button. The brief, the closing events and the admin log are checked for
 * every type with a deadline by the conformance suite (step 5b).
 */

import { test, expect, type Page } from "@playwright/test";
import { adminEmailFor, closeAsAdmin, hubId, liveProposal, liveVote, run, session, visitAs } from "./actors";

async function closeEarlyFromPage(page: Page, noun: string, note: string) {
  await page.getByRole("button", { name: "Close early" }).click();
  const dialog = page.getByRole("dialog", { name: `Close this ${noun} early?` });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: `Close the ${noun} now` });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/Why is it closing early/).fill(note);
  await expect(confirm).toBeEnabled();
  await page.evaluate(() => ((window as unknown as { __stillHere: boolean }).__stillHere = true));
  await confirm.click();
  await expect(dialog).toBeHidden();
}

for (const width of [1280, 375]) {
  test.describe(`Close early at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    let hub = "";
    let admin = "";

    test.beforeAll(async ({ request }) => {
      hub = await hubId(request);
      admin = (await session(hub, adminEmailFor(hub))).token;
    });

    test("a vote: a note is required, and the page shows the line and the note", async ({ page, request }) => {
      const voteId = await liveVote(request, admin, `Close early vote ${width} ${run}`);
      await visitAs(page, admin);
      await page.goto(`/process/${voteId}`);
      const note = `The question was settled at the public meeting (${width}).`;
      await closeEarlyFromPage(page, "vote", note);

      const shown = page.locator(".closed-early-note");
      await expect(shown).toContainText(/Closed early on .+ before the original date of /);
      await expect(shown).toContainText(`Admin note: ${note}`);
      await expect(page.getByRole("heading", { name: "Voting finalized" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Close early" })).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __stillHere?: boolean }).__stillHere)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

      // After a reload, the same, from the server.
      await page.reload();
      await expect(page.locator(".closed-early-note")).toContainText(`Admin note: ${note}`);
    });

    test("a proposal: closed with a note; a resident has no Close early button", async ({ page, request, browser }) => {
      const author = await session(hub, `close-early-author-${width}-${run}@example.test`);
      const proposalId = await liveProposal(request, author.token, admin, `Close early proposal ${width} ${run}`);

      // A resident sees no button.
      const other = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const residentPage = await other.newPage();
        await visitAs(residentPage, author.token);
        await residentPage.goto(`/proposal/${proposalId}`);
        await expect(residentPage.getByRole("button", { name: "Support this proposal" }).or(residentPage.getByText("You have supported"))).toBeVisible();
        await expect(residentPage.getByRole("button", { name: "Close early" })).toHaveCount(0);
      } finally {
        await other.close();
      }

      await visitAs(page, admin);
      await page.goto(`/proposal/${proposalId}`);
      const note = `Withdrawn by the board's own action (${width}).`;
      await closeEarlyFromPage(page, "proposal", note);
      await expect(page.locator(".closed-early-note")).toContainText(`Admin note: ${note}`);
      await expect(page.getByText(/discussion period has ended/)).toBeVisible();
      await closeAsAdmin(request, admin, proposalId); // already closed: a no-op
    });
  });
}
