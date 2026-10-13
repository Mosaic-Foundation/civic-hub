/**
 * Actions show right away (Actions slice, 2026-10-13).
 *
 * A resident's action updates the page from the server's answer: no reload,
 * no second read of the process, and a second press while the first runs
 * sends nothing. Checked on a vote (cast a ballot), a proposal (support it)
 * and a comment, at desktop and phone width.
 */

import { test, expect, type Page, type Request } from "@playwright/test";
import { closeAsAdmin, hubId, liveProposal, liveVote, run, session, visitAs, adminEmailFor } from "./actors";

/** Requests the page makes from now on, as "METHOD path". */
function recordRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r: Request) => {
    const url = new URL(r.url());
    if (url.pathname.includes("/process") || url.pathname.includes("/proposals")) seen.push(`${r.method()} ${url.pathname}`);
  });
  return seen;
}

/** The page's own loads leave a marker; a reload would clear it. */
async function markPage(page: Page) {
  await page.evaluate(() => ((window as unknown as { __stillHere: boolean }).__stillHere = true));
}
async function stillSamePage(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __stillHere?: boolean }).__stillHere === true);
}

for (const width of [1280, 375]) {
  test.describe(`Actions show right away at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    let hub = "";
    let admin = "";
    const made: Array<{ id: string; type: string }> = [];

    test.beforeAll(async ({ request }) => {
      hub = await hubId(request);
      admin = (await session(hub, adminEmailFor(hub))).token;
    });

    test.afterAll(async ({ request }) => {
      for (const p of made) await closeAsAdmin(request, admin, p.id, p.type);
    });

    test("a ballot updates the results, once, however many presses", async ({ page, request }) => {
      const voteId = await liveVote(request, admin, `Right away ${width} ${run}`);
      made.push({ id: voteId, type: "process.close" });
      const resident = await session(hub, `right-away-${width}-${run}@example.test`);
      await visitAs(page, resident.token);
      await page.goto(`/process/${voteId}`);
      await expect(page.locator(".vote-buttons button", { hasText: "Yes" })).toBeVisible();
      await markPage(page);
      const requests = recordRequests(page);

      // Two presses in the same frame: one ballot.
      await page.locator(".vote-buttons button", { hasText: "Yes" }).evaluate((b: HTMLButtonElement) => {
        b.click();
        b.click();
      });
      await expect(page.getByText("Your vote has been recorded")).toBeVisible();
      await expect(page.locator(".result-bar-row", { hasText: "Yes" })).toContainText("1 (100%)");

      expect(requests.filter((r) => r === `POST /api/process/${voteId}/action` || r === `POST /process/${voteId}/action`)).toHaveLength(1);
      // The tally came from the answer, not from reading the vote again.
      expect(requests.some((r) => r.startsWith("GET") && r.includes(`/process/${voteId}/state`))).toBe(false);
      expect(await stillSamePage(page)).toBe(true);
    });

    test("supporting a proposal shows the new count and the button changes", async ({ page, request }) => {
      const author = await session(hub, `right-away-author-${width}-${run}@example.test`);
      const proposalId = await liveProposal(request, author.token, admin, `Support right away ${width} ${run}`);
      made.push({ id: proposalId, type: "process.close" });
      const resident = await session(hub, `right-away-supporter-${width}-${run}@example.test`);
      await visitAs(page, resident.token);
      await page.goto(`/proposal/${proposalId}`);
      const support = page.getByRole("button", { name: "Support this proposal" });
      await expect(support).toBeVisible();
      await markPage(page);
      const requests = recordRequests(page);

      await support.click();
      await expect(page.getByText("You have supported this proposal.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Remove my support" })).toBeEnabled();
      expect(requests.some((r) => r.startsWith("GET") && r.endsWith(`/proposals/${proposalId}`))).toBe(false);
      expect(await stillSamePage(page)).toBe(true);
    });

    test("a comment appears in the list as soon as it is posted", async ({ page, request }) => {
      const author = await session(hub, `right-away-commenter-author-${width}-${run}@example.test`);
      const proposalId = await liveProposal(request, author.token, admin, `Comment right away ${width} ${run}`);
      made.push({ id: proposalId, type: "process.close" });
      const resident = await session(hub, `right-away-commenter-${width}-${run}@example.test`);
      await visitAs(page, resident.token);
      // The comment panel's own first read, before watching for another.
      await Promise.all([
        page.waitForResponse((r) => r.url().endsWith(`/process/${proposalId}/input`)),
        page.goto(`/proposal/${proposalId}`),
      ]);
      await markPage(page);
      const requests = recordRequests(page);

      const words = `Posted right away ${width} ${run}`;
      await page.locator(".proposal-comment-form textarea").fill(words);
      await page.locator(".proposal-comment-form").getByRole("button", { name: /comment/i }).click();
      await expect(page.locator(".community-input-panel")).toContainText(words);
      // Added from the answer: the comment list wasn't read again.
      expect(requests.some((r) => r.startsWith("GET") && r.endsWith(`/process/${proposalId}/input`))).toBe(false);
      expect(await stillSamePage(page)).toBe(true);
    });
  });
}
