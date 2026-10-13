/**
 * The vote pages, tidied (Vote pages fixes, 2026-10-13, from Adam's dev
 * walk of the Actions slice), at desktop and phone width:
 *
 * - a blank option field never blocks Submit: empty fields are dropped, and
 *   two filled options are enough.
 */

import { test, expect } from "@playwright/test";
import { hubId, run, session, visitAs } from "./actors";

for (const width of [1280, 375]) {
  test.describe(`Vote pages at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    let hub = "";

    test.beforeAll(async ({ request }) => {
      hub = await hubId(request);
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
