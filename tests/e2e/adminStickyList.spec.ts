/**
 * Meeting summaries' "Revision waiting" tab, and what stays in view while an
 * admin page scrolls (Adam, 2026-11-13), at desktop and phone width.
 *
 * The tab lists the published summaries with a revision to decide, opens from
 * ?show=revision (where the admin digest links), and the review's back button
 * returns to it. The filter tabs and the bulk-action bar stay under the hub
 * header at the foot of a long list; the review's back button floats there too.
 *
 * Rows are written straight into the local stack and archived afterwards.
 */

import { test, expect, type Page } from "@playwright/test";
import { localRest } from "../fixtures/adminSession.js";
import { adminEmailFor, hubId, run, session, visitAs } from "./actors";

function summary(title: string, approval_status: "pending" | "published", revision: boolean) {
  const now = new Date().toISOString();
  const blocks = Array.from({ length: 12 }, (_, i) => ({
    topic_title: `Topic ${i + 1}`,
    topic_summary: "What was said and decided, at some length so the review page scrolls. ".repeat(4),
    start_time_seconds: null,
    action_taken: null,
  }));
  return {
    type: "civic.meeting_summary",
    source_id: `sticky-${title}`,
    source_minutes_url: "https://example.test/minutes.pdf",
    source_agenda_url: null,
    source_type: "minutes",
    source_video_url: null,
    additional_video_urls: [],
    meeting_title: title,
    meeting_date: "2026-11-01",
    blocks,
    approval_status,
    generated_at: now,
    approved_at: approval_status === "published" ? now : null,
    published_at: approval_status === "published" ? now : null,
    admin_notes: "",
    last_edited_at: null,
    edit_count: 0,
    pending_revision: revision
      ? {
          blocks,
          source_minutes_url: "https://example.test/minutes.pdf",
          source_agenda_url: null,
          source_video_url: null,
          additional_video_urls: [],
          source_type: "minutes",
          reason: "The minutes were posted.",
          ai_instructions_used: "",
          ai_model: "test",
          generated_at: now,
        }
      : null,
    revised_at: null,
    ai_instructions_used: "",
    ai_model: "test",
    ai_attribution_label: "AI-generated, admin-reviewed.",
  };
}

/** The element's top sits just under the hub header: pinned, in view. */
async function pinnedUnderHeader(page: Page, selector: string) {
  const header = await page.locator(".civic-nav").boundingBox();
  const box = await page.locator(selector).first().boundingBox();
  expect(header && box).toBeTruthy();
  expect(box!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 3);
  expect(box!.y).toBeLessThan(header!.y + header!.height + 24);
}

for (const width of [1280, 375]) {
  test.describe(`admin sticky list at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    const inserted: string[] = [];
    test.afterAll(async () => {
      if (inserted.length > 0) {
        await localRest(`processes?id=in.(${inserted.join(",")})`, {
          method: "PATCH",
          body: JSON.stringify({ status: "archived" }),
        });
      }
    });

    test("Revision waiting tab; tabs, bulk bar and back button stay in view", async ({ page, request }) => {
      const hub = await hubId(request);
      const admin = (await session(hub, adminEmailFor(hub))).token;
      const tag = `${run}-${width}`;
      const rows = [
        { title: `Revised ${tag}`, status: "published" as const, revision: true },
        { title: `Live ${tag}`, status: "published" as const, revision: false },
        ...Array.from({ length: 14 }, (_, i) => ({ title: `Waiting ${i} ${tag}`, status: "pending" as const, revision: false })),
      ];
      for (const r of rows) {
        const id = `proc_sticky${Math.random().toString(16).slice(2, 14)}`;
        inserted.push(id);
        await localRest("processes", {
          method: "POST",
          body: JSON.stringify({
            id,
            hub_id: hub,
            type: "civic.meeting_summary",
            status: r.status === "published" ? "finalized" : "active",
            title: r.title,
            description: "",
            state: summary(r.title, r.status, r.revision),
          }),
        });
      }

      await visitAs(page, admin);
      await page.goto("/admin/meeting-summaries?show=revision");
      const tab = page.getByRole("button", { name: /^Revision waiting/ });
      await expect(tab).toHaveClass(/is-active/);
      await expect(page.locator(".admin-proposal-item", { hasText: `Revised ${tag}` })).toBeVisible();
      await expect(page.locator(".admin-proposal-item", { hasText: `Live ${tag}` })).toHaveCount(0);
      await expect(page.locator(".admin-proposal-item", { hasText: `Waiting 0 ${tag}` })).toHaveCount(0);

      // Opened from the tab, the review's back button returns to it.
      await page.locator(".admin-proposal-item", { hasText: `Revised ${tag}` }).locator("h3").click();
      await expect(page).toHaveURL(/\/admin\/meeting-summaries\/proc_sticky/);
      await page.mouse.wheel(0, 3000);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
      const back = page.getByRole("button", { name: "Back to Meeting summaries" });
      await expect(back).toBeInViewport();
      await pinnedUnderHeader(page, ".admin-back-button");
      await back.click();
      await expect(page).toHaveURL(/\/admin\/meeting-summaries\?show=revision$/);
      await expect(tab).toHaveClass(/is-active/);

      // All: a long list. At its foot, the tabs and the bulk bar are still in view.
      await page.getByRole("button", { name: "All", exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/meeting-summaries$/);
      await expect(page.locator(".admin-proposal-item", { hasText: `Waiting 13 ${tag}` })).toBeVisible();
      await page.locator(".admin-proposal-item").last().scrollIntoViewIfNeeded();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
      await expect(tab).toBeInViewport();
      await expect(page.locator(".batch-bar")).toBeInViewport();
      await pinnedUnderHeader(page, ".admin-sticky-bar");

      // A row ticked down there is acted on from the bar without scrolling back up.
      await page.locator(".admin-proposal-item", { hasText: `Waiting 13 ${tag}` }).locator(".batch-checkbox").check();
      await expect(page.getByRole("button", { name: /Archive selected \(1\)/ })).toBeInViewport();
    });
  });
}
