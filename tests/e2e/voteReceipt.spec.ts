/**
 * The voter holds the receipt (ballot secrecy, 2026-10-10).
 *
 * A resident votes: the panel shows the receipt and this browser keeps it
 * (per account and vote). After a reload the panel still knows their choice,
 * from the receipt, not from the server, which keeps nothing linking them
 * to it. They change their vote with it, keeping the same receipt. In a fresh
 * browser with no receipt, the panel says their vote is counted and can be
 * changed only from the browser where they voted, with no buttons that would
 * be refused. The verify link carries the receipt in the fragment, never the
 * query string.
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";
import { E2E_API_BASE as API } from "./hubApi";

const run = Date.now().toString(36);

async function hubId(request: APIRequestContext): Promise<string> {
  return ((await (await request.get(`${API}/hub-config`)).json()) as { hub: { id: string } }).hub.id;
}

/** A session whose account has accepted the current terms (else a dialog covers the page). */
async function session(hub: string, email: string): Promise<{ token: string; userId: string }> {
  const token = await mintSession(hub, email);
  const filter = `users?hub_id=eq.${hub}&email=eq.${encodeURIComponent(email)}`;
  await localRest(filter, { method: "PATCH", body: JSON.stringify({ tos_version_accepted: CURRENT_LEGAL_VERSION }) });
  const [u] = (await localRest(`${filter}&select=id`)) as Array<{ id: string }>;
  return { token, userId: u.id };
}

async function visitAs(page: Page, token: string) {
  await page.addInitScript((t) => {
    localStorage.setItem("seen_intro_popup", "true");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
    sessionStorage.setItem("civic_preview", "1");
    localStorage.setItem("civic_auth_token", t);
  }, token);
}

test.describe("Vote receipts held by the voter", () => {
  let hub = "";
  let admin = "";
  let voteId = "";

  test.beforeAll(async ({ request }) => {
    hub = await hubId(request);
    const email = hub === "floyd" ? "admin@example.test" : `admin+${hub}@example.test`;
    admin = (await session(hub, email)).token;
    const created = await request.post(`${API}/process`, {
      headers: { Authorization: `Bearer ${admin}` },
      data: {
        definition: { type: "civic.vote", version: "0.1" },
        title: `Receipt test ${run}`,
        description: "A vote for the receipt test.",
        state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    voteId = (await created.json()).id;
    const act = await request.post(`${API}/process/${voteId}/action`, {
      headers: { Authorization: `Bearer ${admin}` },
      data: { type: "process.activate", payload: {} },
    });
    expect(act.ok(), await act.text()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    if (!voteId) return;
    await request.post(`${API}/process/${voteId}/action`, {
      headers: { Authorization: `Bearer ${admin}` },
      data: { type: "process.close", payload: {} },
    });
  });

  test("vote, reload, change with the held receipt; another browser cannot change it", async ({ page, browser }) => {
    const resident = await session(hub, `receipt-e2e-${run}@example.test`);
    await visitAs(page, resident.token);
    await page.goto(`/process/${voteId}`);

    // A voted button reads "✓ Yes", so match on the text, not the exact name.
    const option = (label: string) => page.locator(".vote-buttons button", { hasText: label });
    await option("Yes").click();
    await expect(page.getByText("Your vote has been recorded")).toBeVisible();
    const receipt = (await page.locator(".vote-receipt-id code").textContent())?.trim() ?? "";
    expect(receipt).toMatch(/^[0-9a-f-]{36}$/);

    const verify = page.getByRole("link", { name: "Verify my vote" });
    const href = (await verify.getAttribute("href")) ?? "";
    expect(href).toContain(`#receipt=${receipt}`);
    expect(href).not.toContain("?receipt=");

    // This browser keeps it, per account and vote.
    const stored = await page.evaluate(
      ([u, p]) => localStorage.getItem(`civic.voteReceipt.v1:${u}:${p}`),
      [resident.userId, voteId],
    );
    expect(JSON.parse(stored ?? "{}")).toMatchObject({ receipt_id: receipt, choice: "Yes" });

    // After a reload the choice comes from the held receipt.
    await page.reload();
    await expect(page.locator(".vote-receipt-id code")).toHaveText(receipt);
    await expect(option("Yes")).toHaveClass(/voted/);

    // Change it: same receipt, updated.
    await option("No").click();
    await expect(page.getByText("Your vote has been updated")).toBeVisible();
    await expect(page.locator(".vote-receipt-id code")).toHaveText(receipt);
    await expect(option("No")).toHaveClass(/voted/);
    await expect(option("Yes")).not.toHaveClass(/voted/);

    // A fresh browser, same account, no receipt: counted, and only the
    // browser it was cast from can change it.
    const other = await browser.newContext();
    try {
      const fresh = await other.newPage();
      await visitAs(fresh, resident.token);
      await fresh.goto(`/process/${voteId}`);
      await expect(fresh.getByText("You've already voted, and your vote is counted")).toBeVisible();
      await expect(fresh.getByText(/only from the browser where you voted/)).toBeVisible();
      await expect(fresh.locator(".vote-buttons")).toHaveCount(0);
    } finally {
      await other.close();
    }
  });
});
