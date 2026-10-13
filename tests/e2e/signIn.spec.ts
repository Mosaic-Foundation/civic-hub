/**
 * Signing in and joining on a phone (sign-in slice, 2026-10-14).
 *
 *   2. A limit reads as a plain sentence with a time, never a code.
 *   3. The code field offers one-time-code autofill and a number pad.
 *   4. The email's "Sign in" link: one Confirm, then the join step.
 *   5. "Keep me signed in": a 90-day session, remembered by this browser.
 *   6. Joining has no terms checkbox: a line beside Join links the three
 *      documents, each of which opens with "In short".
 *
 * On whichever hub `localhost` resolves to (Athens, a demo, on the local
 * stack with CI's env); codes and links are planted in the LOCAL stack only.
 * The admin's real-code path is used where a demo's any-six-digits would not
 * reach the rule under test. At 375 px, the width that matters.
 */

import { createHash } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { localRest, plantHubCode } from "../fixtures/adminSession.js";
import { adminEmailFor, hubId, run } from "./actors";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** rate_limit_hits' bucket name (src/db/rateLimit.ts), to clear one between tests. */
function bucket(scope: string, by: string, value: string): string {
  return `${scope}:${by}:${sha256(`civic-rate:${value}`)}`;
}

async function freshVisitor(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("seen_intro_popup", "true");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
    sessionStorage.setItem("civic_preview", "1");
  });
}

async function openSignIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
}

test.use({ viewport: { width: 375, height: 812 } });

test.describe("Sign in on a phone", () => {
  test("the code field offers autofill and a number pad", async ({ page }) => {
    await freshVisitor(page);
    await openSignIn(page);
    await expect(page.getByPlaceholder("you@example.com")).toHaveAttribute("autocomplete", "email");
    await page.getByPlaceholder("you@example.com").fill(`autofill-${run}@example.test`);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const code = page.locator("#auth-code");
    await expect(code).toHaveAttribute("autocomplete", "one-time-code");
    await expect(code).toHaveAttribute("inputmode", "numeric");
    await expect(code).toHaveAttribute("pattern", "[0-9]*");
    // Only digits stay, and a pasted "123 456" keeps all six.
    await code.fill("123 456");
    await expect(code).toHaveValue("123456");
  });

  test("a limit is a plain sentence with a time, and a burned code says so", async ({ page, request }) => {
    const hub = await hubId(request);
    const admin = adminEmailFor(hub);
    // A clean start for this address: no live codes, and the minute has passed.
    await localRest(`sign_in_codes?hub_id=eq.${hub}&email=eq.${encodeURIComponent(admin)}`, { method: "DELETE" });
    await localRest(`rate_limit_hits?bucket=eq.${bucket("hub.code_email", "email", `${hub}:${admin}`)}`, { method: "DELETE" });

    await freshVisitor(page);
    await openSignIn(page);
    await page.getByPlaceholder("you@example.com").fill(admin);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

    // Asking again inside the minute: the time to ask again, and nothing else.
    await page.getByRole("button", { name: "Resend code" }).click();
    const error = page.locator(".form-error");
    await expect(error).toHaveText(/^We just sent you a code\. You can ask for another after \d{1,2}:\d\d [AP]M( UTC)?\.$/);
    await expect(error).not.toContainText("_");

    // Five wrong tries burn the code; the sentence says what to do.
    await localRest(`sign_in_codes?hub_id=eq.${hub}&email=eq.${encodeURIComponent(admin)}`, { method: "DELETE" });
    await plantHubCode(hub, admin, "604020");
    const field = page.locator("#auth-code");
    for (let i = 0; i < 4; i++) {
      await field.fill(String(100000 + i));
      await page.getByRole("button", { name: "Verify", exact: true }).click();
      await expect(error).toHaveText("That code isn't right. Check it and try again.");
    }
    await field.fill("100009");
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(error).toHaveText("That code has stopped working after too many tries. Ask for a new code.");
    await localRest(`sign_in_codes?hub_id=eq.${hub}&email=eq.${encodeURIComponent(admin)}`, { method: "DELETE" });
  });

  test("Keep me signed in makes a 90-day session, and this browser remembers the choice", async ({ page }) => {
    await freshVisitor(page);
    await openSignIn(page);
    await page.getByPlaceholder("you@example.com").fill(`keep-${run}@example.test`);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const keep = page.getByLabel("Keep me signed in on this device");
    await expect(keep).not.toBeChecked();
    await keep.check();
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page.getByRole("button", { name: "Join", exact: true })).toBeVisible();

    const token = await page.evaluate(() => localStorage.getItem("civic_auth_token") ?? "");
    expect(await page.evaluate(() => localStorage.getItem("civic_keep_signed_in"))).toBe("1");
    // Not logged in until Join (Slice 13.10), but the session exists already.
    const sessions = (await localRest(`sessions?select=expires_at&order=created_at.desc&limit=5`)) as Array<{ expires_at: string }>;
    expect(token).toBe("");
    expect(sessions.some((s) => Date.parse(s.expires_at) - Date.now() > 89 * 24 * 3600_000)).toBe(true);

    // A later sign-in in this browser starts ticked.
    await page.goto("/");
    await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
    await page.getByPlaceholder("you@example.com").fill(`keep2-${run}@example.test`);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByLabel("Keep me signed in on this device")).toBeChecked();
  });

  test("joining has no terms checkbox: one line beside Join, and each document opens with In short", async ({ page }) => {
    await freshVisitor(page);
    await openSignIn(page);
    await page.getByPlaceholder("you@example.com").fill(`join-${run}@example.test`);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Verify", exact: true }).click();

    const join = page.getByRole("button", { name: "Join", exact: true });
    await expect(join).toBeVisible();
    // The residency (here: demo) box stays; it is the only checkbox, and says nothing about policies.
    const boxes = page.locator(".auth-modal input[type=checkbox]");
    await expect(boxes).toHaveCount(1);
    await expect(page.locator(".auth-legal-checkbox")).not.toContainText("agree");

    const notice = page.locator(".auth-terms-notice");
    await expect(notice).toHaveText("By joining you agree to the Code of Conduct, Privacy Notice and Terms.");
    for (const [name, href] of [["Code of Conduct", "/code-of-conduct"], ["Privacy Notice", "/privacy"], ["Terms", "/terms"]]) {
      await expect(notice.getByRole("link", { name })).toHaveAttribute("href", href);
    }

    // Each shared document starts with its plain-language summary. (A hub
    // that wrote its own document shows its own text; tests leave one on the
    // local Athens's Code of Conduct, so that page isn't checked here.)
    const doc = await page.context().newPage();
    for (const href of ["/privacy", "/terms"]) {
      await doc.goto(href);
      await expect(doc.getByRole("heading", { name: "In short" })).toBeVisible();
    }
    await doc.close();

    await page.getByPlaceholder("Jane Doe").fill("Joining Person");
    await page.locator(".auth-legal-checkbox input[type=checkbox]").check();
    await join.click();
    await expect(join).toHaveCount(0);
    // No re-acceptance dialog afterwards: joining recorded the agreement.
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("the email's Sign in link: one Confirm, the token gone from the address bar, then Join", async ({ page, request }) => {
    const hub = await hubId(request);
    const email = `link-${run}@example.test`;
    const token = `e2elink${run}${"k".repeat(36)}`;
    await plantHubCode(hub, email, "771177", { linkToken: token });

    await freshVisitor(page);
    await page.goto(`/sign-in#t=${token}`);
    await expect(page.getByRole("heading", { name: /^Sign in to / })).toBeVisible();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
    // Nothing happened on opening: the code is still there.
    expect(((await localRest(`sign_in_codes?hub_id=eq.${hub}&email=eq.${encodeURIComponent(email)}`)) as unknown[]).length).toBe(1);

    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("button", { name: "Join", exact: true })).toBeVisible();
    await page.getByPlaceholder("Jane Doe").fill("Link Person");
    await page.locator(".auth-legal-checkbox input[type=checkbox]").check();
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(await page.evaluate(() => localStorage.getItem("civic_auth_token"))).toBeTruthy();

    // Spent: the same link again says so, plainly.
    const again = await page.context().newPage();
    await again.addInitScript(() => localStorage.removeItem("civic_auth_token"));
    await again.goto(`/sign-in#t=${token}`);
    await again.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(again.getByRole("alert")).toHaveText("This sign-in link has expired or has already been used. Ask for a new code.");
  });
});
