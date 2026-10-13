/**
 * The receipt file and the check page, in both modes (Actions slice,
 * 2026-10-13, Adam), at desktop and phone width.
 *
 * A resident votes and downloads their receipt: a PDF titled by the vote and
 * the date, with the receipt code and the check page's address (the QR code
 * opens the same address; its modules are checked in
 * tests/unit/receiptPdf.test.ts). A "show the choice" receipt says to keep it
 * private. Before close the check page says only that the vote is still
 * open; after close it answers in the vote's mode:
 *   show the choice: "A ballot with this code was counted in “<vote>”, for <option>."
 *   counted only:    "A ballot with this code was counted in “<vote>”." and
 *                    the log shows codes only.
 */

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { adminEmailFor, closeAsAdmin, hubId, liveVote, run, session, visitAs } from "./actors";

const MODES = [
  { mode: "show_choice" as const, line: "Keep this private; anyone with this code can see how this ballot was cast." },
  { mode: "counted_only" as const, line: "This code shows only that your ballot was counted. It never shows how you voted." },
];

for (const width of [1280, 375]) {
  for (const { mode, line } of MODES) {
    test.describe(`Receipt, ${mode}, at ${width}px`, () => {
      test.use({ viewport: { width, height: 900 } });

      test("download the receipt, then check it before and after the vote closes", async ({ page, request }, info) => {
        const hub = await hubId(request);
        const admin = (await session(hub, adminEmailFor(hub))).token;
        const title = `Receipt ${mode} ${width} ${run}`;
        const voteId = await liveVote(request, admin, title, { check_mode: mode });
        const voter = await session(hub, `receipt-${mode}-${width}-${run}@example.test`);
        await visitAs(page, voter.token);
        await page.goto(`/process/${voteId}`);
        await page.locator(".vote-buttons button", { hasText: "Yes" }).click();
        const code = ((await page.locator(".vote-receipt-id code").textContent()) ?? "").trim();
        expect(code).toMatch(/^[0-9a-f-]{36}$/);

        // The file.
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          page.getByRole("button", { name: "Download receipt (PDF)" }).click(),
        ]);
        const today = await page.evaluate(() => {
          const d = new Date();
          const p = (n: number) => String(n).padStart(2, "0");
          return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        });
        expect(download.suggestedFilename()).toBe(`Vote receipt - ${title} - ${today}.pdf`);
        const saved = info.outputPath(`receipt-${mode}-${width}.pdf`);
        await download.saveAs(saved);
        const pdf = readFileSync(saved, "latin1");
        expect(pdf.startsWith("%PDF-1.4")).toBe(true);
        expect(pdf).toContain(code);
        expect(pdf).toContain(title);
        expect(pdf).toContain(line);
        expect(pdf).toContain(`/votes/${voteId}/log#receipt=`);
        expect(pdf).not.toContain("(Yes)"); // no choice on the file

        // Before close: open only.
        await page.goto(`/votes/${voteId}/log#receipt=${code}`);
        await expect(page.getByText("This vote is still open. Receipts can be checked once it closes.")).toBeVisible();
        await expect(page.locator(".receipt-search-input")).toHaveCount(0);

        // After close: the vote's mode.
        await closeAsAdmin(request, admin, voteId);
        await page.reload();
        const answer = page.locator(".receipt-result-title");
        if (mode === "show_choice") {
          await expect(answer).toHaveText(`A ballot with this code was counted in “${title}”, for Yes.`);
          await expect(page.locator(".vote-log-row", { hasText: code })).toContainText("Yes");
        } else {
          await expect(answer).toHaveText(`A ballot with this code was counted in “${title}”.`);
          await expect(page.locator(".vote-log-row", { hasText: code })).not.toContainText("Yes");
          await expect(page.locator(".vote-log-header")).not.toContainText("Vote");
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

        // The vote's page keeps the receipt after close, with the download.
        await page.goto(`/process/${voteId}`);
        await expect(page.locator(".vote-receipt-title", { hasText: "Your receipt" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Download receipt (PDF)" })).toBeVisible();
      });
    });
  }
}
