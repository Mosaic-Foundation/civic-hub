/**
 * Regenerate summary (Actions slice, 2026-10-13), at desktop and phone width.
 *
 * An admin closes a vote early; its brief waits for review. Regenerate makes
 * it again in place, keeping the old text under "Earlier versions". Once the
 * brief is published, Regenerate stages a new version beside it: the public
 * page is unchanged until the admin publishes it, then shows the new text
 * and "updated <date>". Brief contents, the feed card, the admin log and
 * "no second email" are checked in tests/api/briefRegenerate.test.ts.
 */

import { test, expect } from "@playwright/test";
import { localRest } from "../fixtures/adminSession.js";
import { adminEmailFor, closeAsAdmin, hubId, liveVote, run, session, visitAs } from "./actors";
import { E2E_API_BASE as API } from "./hubApi";

for (const width of [1280, 375]) {
  test.describe(`Regenerate summary at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("unpublished: made again in place; published: staged, then published in place", async ({ page, request }) => {
      const hub = await hubId(request);
      const admin = (await session(hub, adminEmailFor(hub))).token;
      const voteId = await liveVote(request, admin, `Regenerate ${width} ${run}`);
      await closeAsAdmin(request, admin, voteId, "process.close", "The board decided the question directly.");
      const [brief] = (await localRest(
        `processes?select=id,state&type=eq.civic.brief&state->>source_process_id=eq.${voteId}`,
      )) as Array<{ id: string; state: Record<string, any> }>;

      await visitAs(page, admin);
      await page.goto(`/admin/briefs/${brief.id}`);
      await expect(page.locator(".closed-early-note")).toContainText("Admin note: The board decided the question directly.");

      // Unpublished: confirm, then it's made again; the old text is kept.
      await page.getByRole("button", { name: "Regenerate summary" }).click();
      await page.getByRole("dialog", { name: "Regenerate this brief?" }).getByRole("button", { name: "Regenerate" }).click();
      await expect(page.getByText(/Made again\. The text it replaced is kept/)).toBeVisible();
      await expect(page.locator(".brief-history summary")).toHaveText("1 earlier version");

      // Publish it with nobody to email, then stand in for a poor published text.
      const auth = { Authorization: `Bearer ${admin}` };
      expect((await request.patch(`${API}/admin/briefs/${brief.id}`, { headers: auth, data: { recipients: [] } })).ok()).toBeTruthy();
      expect((await request.post(`${API}/admin/briefs/${brief.id}/approve`, { headers: auth, data: {} })).ok()).toBeTruthy();
      const [published] = (await localRest(`processes?select=state&id=eq.${brief.id}`)) as Array<{ state: Record<string, any> }>;
      await localRest(`processes?id=eq.${brief.id}`, {
        method: "PATCH",
        body: JSON.stringify({ state: { ...published.state, content: { ...published.state.content, headline: `A poor headline ${run}` } } }),
      });

      await page.reload();
      await page.getByRole("button", { name: "Regenerate summary" }).click();
      await expect(page.getByText(/A new version is ready below/)).toBeVisible();
      const staged = page.locator(".brief-revision");
      await expect(staged).toBeVisible();

      // The public page still shows the published text.
      const visitor = await page.context().browser()!.newContext({ viewport: { width, height: 900 } });
      try {
        const pub = await visitor.newPage();
        await pub.goto(`/brief/${brief.id}`);
        await expect(pub.getByText(`A poor headline ${run}`)).toBeVisible();

        await staged.getByRole("button", { name: "Publish this version" }).click();
        await expect(page.getByText(/Published\. The brief's page and its feed card show the new version\. Nobody was emailed\./)).toBeVisible();
        await expect(page.locator(".brief-history summary")).toHaveText("2 earlier versions");

        await pub.reload();
        await expect(pub.getByText(`A poor headline ${run}`)).toHaveCount(0);
        await expect(pub.locator(".vote-results-provenance")).toContainText(", updated ");
        await expect(pub.locator(".closed-early-note")).toContainText("Admin note: The board decided the question directly.");
        expect(await pub.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      } finally {
        await visitor.close();
      }
    });
  });
}
