/**
 * Updates on the Plugins page (plugin session 2, ADR-015), as a hub's admin:
 *   - the intro says what Install, Stop now, Wind down and Update do;
 *   - a hub still on Briefs 0.1.0's grant (no AI) gets a conversation's brief
 *     without a written summary, and the conversation's page says why;
 *   - the Briefs card says an update is available and that until then it
 *     keeps to what was approved; Update shows what changes, in the Install
 *     words, and afterwards the card no longer offers it.
 *
 * On whichever hub `localhost` resolves to (Athens on the local stack with
 * CI's env). The hub's Briefs record is put back to the version this
 * deployment runs, in afterEach.
 */

import { test, expect } from "@playwright/test";
import { localRest } from "../fixtures/adminSession.js";
import { adminEmailFor, closeAsAdmin, hubId, run, session, visitAs } from "./actors";
import { E2E_API_BASE as API } from "./hubApi";

const BRIEF = "@civic-social/plugin-brief";

test.describe("Update on the Plugins page", () => {
  let putBack: (() => Promise<void>) | null = null;
  test.afterEach(async () => {
    await putBack?.();
    putBack = null;
  });

  test("a hub that has not approved the brief's AI: a brief without a summary, the page says why, and Update shows what changes", async ({ page, request }) => {
    const hub = await hubId(request);
    const admin = (await session(hub, adminEmailFor(hub))).token;
    const auth = { Authorization: `Bearer ${admin}` };
    const filter = `hub_plugins?hub_id=eq.${hub}&package=eq.${encodeURIComponent(BRIEF)}`;
    const [record] = (await localRest(`${filter}&select=version,capabilities`)) as Array<{ version: string; capabilities: Record<string, unknown> }>;
    putBack = async () => {
      await localRest(filter, { method: "PATCH", body: JSON.stringify({ version: record.version, capabilities: record.capabilities }) });
    };
    // As a hub that has not taken Briefs 0.2.0: 0.1.0, whose grant has no AI.
    await localRest(filter, {
      method: "PATCH",
      body: JSON.stringify({ version: "0.1.0", capabilities: { ...record.capabilities, adapters: ["mail"] }, upgraded_by: null, upgraded_from: null, upgraded_at: null }),
    });

    // A conversation closes: its brief is made, without a written summary.
    const topic = `Not approved yet ${run}`;
    const made = await request.post(`${API}/deliberations`, { headers: auth, data: { title: topic, topic, framing: "What should the hub know?" } });
    expect(made.status(), await made.text()).toBe(201);
    const body = (await made.json()) as { id?: string; process_id?: string };
    const id = (body.id ?? body.process_id)!;
    await closeAsAdmin(request, admin, id, "close", "Closed by the update test.");

    await visitAs(page, admin);
    await page.goto(`/deliberation/${id}`);
    await expect(page.getByText("No written summary: this hub has not allowed briefs to use AI.")).toBeVisible();
    await expect(page.locator(".completed-stats")).toContainText("participants");

    await page.goto("/admin/settings/plugins#brief");
    const intro = page.getByTestId("plugins-intro");
    await expect(intro).toContainText("To remove one, choose Stop now or Wind down.");
    await expect(intro).toContainText("Update shows what will change in what it can do before you take it.");
    await expect(intro).not.toContainText("Switch off anything this hub does not use");

    const card = page.getByRole("region", { name: "Briefs", exact: true });
    await expect(card.getByText(/Update available/)).toBeVisible();
    await expect(card.getByText(/version 0\.2\.1\. Until you update, it keeps to what you approved/)).toBeVisible();
    await card.getByRole("button", { name: "Update…" }).click();

    const dialog = page.getByRole("dialog", { name: "Update Briefs to version 0.2.1?" });
    await expect(dialog.getByText("Briefs will also be able to:")).toBeVisible();
    await expect(dialog.getByText("Use the hub's AI service. Each use counts against the hub's daily AI allowance.")).toBeVisible();
    await expect(dialog.getByText(/From version 0\.1\.0 to 0\.2\.1, checked by Civic\.Social on/)).toBeVisible();
    await dialog.getByRole("button", { name: "Update", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(card.getByText(/Update available/)).toHaveCount(0);
    await expect(card.getByText(/version 0\.2\.1/)).toBeVisible();

    const [after] = (await localRest(`${filter}&select=version,upgraded_from`)) as Array<{ version: string; upgraded_from: string }>;
    expect(after).toEqual({ version: "0.2.1", upgraded_from: "0.1.0" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  });
});
