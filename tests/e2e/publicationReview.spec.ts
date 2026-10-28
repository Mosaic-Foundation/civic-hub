/**
 * The admin's publication review (AdminBriefs on the shared shell,
 * components/AdminPublicationReview; frontend pass, 2026-10-24; the vote
 * results review retired into briefs, engine 2, C).
 *
 * A pending brief: in the queue with its status, the filter finds it, it
 * opens for review, a save keeps it pending, and Approve and publish asks for
 * a confirmation and publishes it (the brief a vote this run closes makes).
 */

import { test, expect } from "@playwright/test";
import { localRest } from "../fixtures/adminSession.js";
import { adminEmailFor, closeAsAdmin, hubId, liveVote, run, session, visitAs } from "./actors";

test.describe("the publication review", () => {
  test("a brief: queued, opened, saved, approved and published", async ({ page, request }) => {
    const hub = await hubId(request);
    const admin = await session(hub, adminEmailFor(hub));
    // A closed vote makes its brief, pending; its content is set here so the
    // page has known text to show.
    const source = await liveVote(request, admin.token, `Review source ${run}`);
    await closeAsAdmin(request, admin.token, source);
    let rows: Array<{ id: string; state: Record<string, unknown> }> = [];
    await expect
      .poll(async () => {
        rows = (await localRest(
          `processes?hub_id=eq.${hub}&type=eq.civic.brief&state->>source_process_id=eq.${source}&select=id,state`,
        )) as typeof rows;
        return rows.length;
      }, { timeout: 15_000 })
      .toBe(1);
    const id = rows[0]!.id;
    const state = rows[0]!.state as { content: Record<string, unknown> };
    await localRest(`processes?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: `Review brief ${run}`,
        state: {
          ...state,
          publication_status: "pending",
          content: { ...state.content, title: `Review brief ${run}`, headline: `Headline ${run}`, comments: ["First", "Second"], admin_notes: "" },
        },
      }),
    });

    await visitAs(page, admin.token);
    await page.goto("/admin/briefs");
    const row = page.locator(".admin-proposal-item", { hasText: `Review brief ${run}` });
    await expect(row).toBeVisible();
    await expect(row.locator(".status-badge.admin-brief-status-pending")).toHaveText("pending review");
    await page.getByRole("button", { name: "Published", exact: true }).click();
    await expect(row).toHaveCount(0);
    await page.getByRole("button", { name: "Pending", exact: true }).click();
    await expect(row).toBeVisible();

    await row.click();
    await expect(page).toHaveURL(new RegExp(`/admin/briefs/${id}$`));
    await expect(page.getByRole("heading", { name: `Review: Review brief ${run}` })).toBeVisible();
    await expect(page.locator(".admin-detail-section input.form-input").first()).toHaveValue(`Headline ${run}`);
    await expect(page.locator(".admin-detail-section textarea").nth(1)).toHaveValue("First\nSecond");

    await page.locator(".admin-detail-section textarea").nth(1).fill("First\n\n  Third  ");
    await page.getByRole("button", { name: "Save for later" }).click();
    await expect(page.locator(".admin-action-message")).toHaveText("Saved — the brief stays pending until you approve it.");
    const saved = (await localRest(`processes?id=eq.${id}&select=state`)) as Array<{ state: { content: { comments: string[] }; publication_status: string } }>;
    expect(saved[0]!.state.content.comments).toEqual(["First", "Third"]);
    expect(saved[0]!.state.publication_status).toBe("pending");

    await page.getByRole("button", { name: "Approve and publish" }).click();
    await expect(page.getByText(/This cannot be undone/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Confirm: approve and publish" })).toHaveCount(0);
    await page.getByRole("button", { name: "Approve and publish" }).click();
    await page.getByRole("button", { name: "Confirm: approve and publish" }).click();
    await expect(page.locator(".admin-action-message")).not.toHaveText(/Saved/);
    await expect(page.locator(".admin-subtitle .admin-brief-status-published")).toHaveText("published");
    await expect(page.getByRole("button", { name: "Approve and publish" })).toHaveCount(0);

    await page.getByRole("button", { name: /Back to Briefs/ }).click();
    await expect(page).toHaveURL(/\/admin\/briefs$/);
    await expect(row.locator(".admin-brief-status-published")).toBeVisible();
  });

  // Removed (engine 2, C): "a vote result opens for review with its positions
  // and the vote it snapshotted". civic.vote_results is retired into briefs;
  // /admin/vote-results/:id no longer exists (a converted record is reviewed
  // as a brief, covered above).
});
