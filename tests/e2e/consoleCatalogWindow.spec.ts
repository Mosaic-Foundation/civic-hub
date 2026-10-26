/**
 * One fresh code confirms the console's catalog actions for ten minutes
 * (plugin session 2, ADR-015), as the operator meets it: the first action
 * asks for a code (and says one is on its way); after it, the page says until
 * when no code is needed, and the next actions go through without the dialog;
 * each is still recorded. On the straw poll's entry (in the catalog, loaded by
 * no deployment), left withdrawn.
 *
 * Needs the console's env on the API (CIVIC_CONSOLE_HOSTNAME=console.localhost,
 * CIVIC_CONSOLE_ADMIN_EMAIL=operator@example.test), as e2e.yml runs it.
 */

import { test, expect, type Page } from "@playwright/test";
import { localRest } from "../fixtures/adminSession.js";
import { mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";

const UI = new URL(process.env.CIVIC_E2E_UI_ORIGIN?.trim() || "http://localhost:5173");
const CONSOLE_UI = `${UI.protocol}//console.localhost${UI.port ? `:${UI.port}` : ""}/console.html`;
const STRAW = "@civic-social-examples/plugin-straw-poll";

async function statusOf(page: Page): Promise<string> {
  return (await page.getByTestId(`catalog-${STRAW}`).locator(".cx-plugin-status").first().innerText()).trim();
}

test("one code confirms catalog changes for ten minutes; each change is still recorded", async ({ page, context }) => {
  const cookie = await mintConsoleSession();
  const [name, value] = cookie.split("=");
  await context.addCookies([{ name: name!, value: decodeURIComponent(value!), domain: "console.localhost", path: "/" }]);
  await page.goto(`${CONSOLE_UI}#/plugins`);
  const entry = page.getByTestId(`catalog-${STRAW}`);
  await expect(entry).toBeVisible();
  await expect(page.getByTestId("catalog-confirmed")).toHaveCount(0);

  const approved = (await statusOf(page)) === "Approved";
  const steps = approved ? ["Withdraw", "Approve", "Withdraw"] : ["Approve", "Withdraw", "Approve"];

  // The first asks for a code, and says one is on its way (no refusal shown).
  await entry.getByRole("button", { name: steps[0], exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm with a fresh code" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/A six-digit code is on its way to your email\./)).toBeVisible();
  await expect(dialog.getByTestId("step-up-notice")).toHaveCount(0);
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantCode("step_up", code);
  await dialog.getByLabel("Code").fill(code);
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("catalog-confirmed")).toContainText("Your code confirms catalog changes until");

  // The next ones go through at once.
  for (const step of steps.slice(1)) {
    await entry.getByRole("button", { name: step, exact: true }).click();
    await expect(entry.locator(".cx-plugin-status").first()).toHaveText(step === "Approve" ? "Approved" : "Withdrawn");
    await expect(dialog).toHaveCount(0);
  }

  const [row] = (await localRest(`plugin_catalog?select=id&package=eq.${encodeURIComponent(STRAW)}`)) as Array<{ id: string }>;
  const audit = (await localRest(
    `control_audit_log?select=action,after&action=in.(plugin.approve,plugin.withdraw)&after->>id=eq.${row!.id}&order=id.desc&limit=3`,
  )) as Array<{ action: string; after: { confirmed: string } }>;
  expect(audit.reverse().map((r) => r.after.confirmed)).toEqual(["code", "window", "window"]);

  // Leave it withdrawn (still inside the window: no code).
  if ((await statusOf(page)) === "Approved") {
    await entry.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(entry.locator(".cx-plugin-status").first()).toHaveText("Withdrawn");
  }
});
