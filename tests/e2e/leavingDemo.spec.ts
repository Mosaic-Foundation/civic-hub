/**
 * Leaving demo, and going live, in the browser (leaving-demo slice, 2026-10-15).
 * The rules are proved over HTTP in tests/api/leavingDemo.test.ts; this checks
 * what an admin sees and does on Settings → Mode.
 *
 *   1. The readiness check blocks (time zone, postal address), then allows.
 *   2. The confirmation wording: demo → beta, and beta → live with the
 *      waitlist's checkbox.
 *   3. demo → beta → live through the UI with a planted code, content kept.
 *   4. The mode notice comes back in full after the mode changes.
 *   5. A new admin's first sign-in lands on "Next: set up your hub".
 *   6. The Mode page at 375 and 1280 px in both navigation layouts.
 *
 * Every hub is made fresh through the console API (slug `e2e-ld-<run id>-x`),
 * reached at http://<slug>.localhost:<the preview's port>, and suspended
 * afterwards. Codes are planted in the LOCAL stack only. The API runs with the
 * console's env (CIVIC_CONSOLE_HOSTNAME=console.localhost,
 * CIVIC_CONSOLE_ADMIN_EMAIL=operator@example.test).
 */

import { createHash } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { localRest, plantHubCode } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession } from "../fixtures/consoleCall.js";
import { call } from "../fixtures/hostCall.js";
import { run, session, visitAs } from "./actors";

const UI = new URL(process.env.CIVIC_E2E_UI_ORIGIN?.trim() || "http://localhost:5173");
const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 900 };

const slugs = { a: `e2e-ld-${run}-a`, b: `e2e-ld-${run}-b`, c: `e2e-ld-${run}-c` };
const hostOf = (slug: string) => `${slug}.localhost`;
const originOf = (slug: string) => `${UI.protocol}//${hostOf(slug)}${UI.port ? `:${UI.port}` : ""}`;
const adminEmail = (slug: string) => `ld-admin+${slug}@example.test`;

const tokens: Record<string, string> = {};
const created: string[] = [];

async function createDemoHub(slug: string): Promise<void> {
  const cookie = await mintConsoleSession();
  const res = await consoleCall("POST", "/control/hubs", {
    cookie,
    body: {
      slug,
      name: `Leaving Demo ${slug}`,
      hostname: hostOf(slug),
      admin_email: adminEmail(slug),
      hub_kind: "place",
      jurisdiction_name: "Test Township",
      jurisdiction_type: "town",
      jurisdiction_custom: true,
      // A custom place gets no suggested time zone, so readiness blocks on it.
      timezone: "",
      mode: "demo",
      sample_content: true,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.push(slug);
  tokens[slug] = (await session(slug, adminEmail(slug))).token;
}

async function putSettings(slug: string, section: string, values: Record<string, string>): Promise<void> {
  const res = await call("PUT", "/admin/hub/settings", hostOf(slug), { section, values }, tokens[slug]);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/** The two blocking items, set through the API. */
async function makeReady(slug: string): Promise<void> {
  await putSettings(slug, "email", { "email.postal_address": "1 Test Street, Test Township" });
  await putSettings(slug, "identity", { "identity.timezone": "America/Chicago" });
}

async function adminVote(slug: string): Promise<{ id: string; title: string }> {
  const title = `An admin's vote ${run} ${slug.slice(-1)}`;
  const host = hostOf(slug);
  const made = await call("POST", "/process", host, {
    definition: { type: "civic.vote", version: "0.1" },
    title,
    description: "Made before leaving demo.",
    state: { options: ["Yes", "No"], voting_duration_ms: 14 * 86_400_000, activation_mode: "direct" },
  }, tokens[slug]);
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  await call("POST", `/process/${made.body.id}/action`, host, { type: "process.activate", payload: {} }, tokens[slug]);
  return { id: made.body.id as string, title };
}

async function adminAnnouncement(slug: string): Promise<{ id: string; title: string }> {
  const title = `An admin's announcement ${run} ${slug.slice(-1)}`;
  const res = await call("POST", "/announcement", hostOf(slug), { title, body: "Made before leaving demo." }, tokens[slug]);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: res.body.id as string, title };
}

async function adminPage(page: Page, slug: string): Promise<void> {
  await visitAs(page, tokens[slug]);
}

async function openMode(page: Page, slug: string): Promise<void> {
  await page.goto(`${originOf(slug)}/admin/settings/mode`);
  await expect(page.getByRole("radio", { name: /^Beta/ })).toBeVisible();
}

const choice = (page: Page, mode: "Beta" | "Live") => page.getByRole("radio", { name: new RegExp(`^${mode}`) });
const readiness = (page: Page, mode: string) => page.getByRole("region", { name: `Before you switch to ${mode}` });
const consequences = (page: Page) => page.getByRole("region", { name: "What happens when you switch" });
const emailCode = (page: Page) => page.getByRole("button", { name: "Email me a code" });

/** Tick every "accept" box in the list (each open, non-blocking item has one). */
async function acceptAll(page: Page, mode: string): Promise<void> {
  const boxes = readiness(page, mode).locator(".mode-readiness-item input[type=checkbox]");
  for (const box of await boxes.all()) await box.check();
}

/** rate_limit_hits' bucket for one address's code requests (src/db/rateLimit.ts). */
async function clearCodeCooldown(slug: string, email: string): Promise<void> {
  const hash = createHash("sha256").update(`civic-rate:${slug}:${email}`).digest("hex");
  await localRest(`rate_limit_hits?bucket=eq.${encodeURIComponent(`hub.code_email:email:${hash}`)}`, { method: "DELETE" });
}

/** Press "Email me a code", plant a known one in its place, and switch. */
async function confirmSwitch(page: Page, slug: string, mode: "beta" | "live"): Promise<void> {
  // One code a minute per address: a second switch soon after the first must not wait.
  await clearCodeCooldown(slug, adminEmail(slug));
  await emailCode(page).click();
  const code = String(100000 + Math.floor(Math.random() * 899999));
  const field = page.getByLabel("Confirmation code");
  await expect(field).toBeVisible();
  await plantHubCode(slug, adminEmail(slug), code);
  await field.fill(code);
  await page.getByRole("button", { name: `Switch to ${mode}` }).click();
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await createDemoHub(slugs.a);
  await createDemoHub(slugs.b);
  await createDemoHub(slugs.c);
});

test.afterAll(async () => {
  for (const slug of created) {
    await localRest(`hubs?id=eq.${slug}`, { method: "PATCH", body: JSON.stringify({ status: "suspended" }) }).catch(() => undefined);
  }
});

test.describe.configure({ mode: "serial" });

test.describe("Mode page on a fresh demo hub", () => {
  test.use({ viewport: DESKTOP });

  test("the readiness check blocks while the time zone and postal address are missing, then lets the admin ask for a code", async ({ page }) => {
    const slug = slugs.a;
    // The platform may have a postal address of its own, which counts as done.
    const before = await call("GET", "/admin/hub/mode/readiness?to=beta", hostOf(slug), undefined, tokens[slug]);
    const postalBlocks = (before.body.items as Array<{ id: string; done: boolean }>).find((i) => i.id === "postal_address")!.done === false;

    await adminPage(page, slug);
    await openMode(page, slug);
    await choice(page, "Beta").check();

    const list = readiness(page, "beta");
    await expect(list).toBeVisible();
    for (const id of ["name_and_place", "timezone", "postal_address", "contact_email", "second_admin", "legal_reviewed", "samples"]) {
      await expect(list.locator(`.mode-readiness-item[data-item="${id}"]`)).toHaveCount(1);
    }
    const tz = list.locator('.mode-readiness-item[data-item="timezone"]');
    await expect(tz.getByRole("link", { name: /^Set it in/ })).toBeVisible();
    await expect(tz.getByRole("checkbox")).toHaveCount(0);
    if (postalBlocks) await expect(list.locator('.mode-readiness-item[data-item="postal_address"]').getByRole("checkbox")).toHaveCount(0);
    await expect(emailCode(page)).toBeDisabled();

    // Accepting everything that can be accepted is not enough while one blocks.
    await acceptAll(page, "beta");
    await page.getByRole("radio", { name: "Keep them for now" }).check();
    await expect(emailCode(page)).toBeDisabled();

    // Set what blocks (through the API, as another tab would) and ask again.
    await makeReady(slug);
    await choice(page, "Live").check();
    await choice(page, "Beta").check();
    await expect(tz).toHaveClass(/is-done/);
    await expect(list.locator('.mode-readiness-item[data-item="postal_address"]')).toHaveClass(/is-done/);
    // Nothing blocks now, but the rest is not yet accepted.
    await expect(emailCode(page)).toBeDisabled();
    await acceptAll(page, "beta");
    await expect(emailCode(page)).toBeEnabled();
  });

  test("the confirmation for demo to beta says, in plain words, what the switch does", async ({ page }) => {
    await adminPage(page, slugs.a);
    await openMode(page, slugs.a);
    await choice(page, "Beta").check();
    const lines = consequences(page);
    await expect(lines).toBeVisible();
    await expect(lines.getByRole("heading", { name: "What happens when you switch to beta" })).toBeVisible();
    await expect(lines).toContainText("Everyone signs in with a real code from their email");
    await expect(lines).toContainText("The demo notice becomes the beta notice.");
    await expect(lines).toContainText("There is no way back to demo, for you or for the platform.");
    // Waitlist emails are only for going live.
    await expect(lines.getByRole("checkbox")).toHaveCount(0);
  });
});

test.describe("Switching a hub through the UI", () => {
  test.use({ viewport: DESKTOP });
  let vote = { id: "", title: "" };
  let announcement = { id: "", title: "" };

  test.beforeAll(async () => {
    await makeReady(slugs.b);
    vote = await adminVote(slugs.b);
    announcement = await adminAnnouncement(slugs.b);
  });

  async function contentIsStillThere(page: Page, slug: string): Promise<void> {
    for (const item of [vote, announcement]) {
      expect((await call("GET", `/process/${item.id}`, hostOf(slug))).status).toBe(200);
      await page.goto(`${originOf(slug)}/process/${item.id}`);
      await expect(page.getByText(item.title).first()).toBeVisible();
    }
  }

  test("demo to beta with a code keeps the admin's vote and announcement and says the hub switched", async ({ page }) => {
    const slug = slugs.b;
    await adminPage(page, slug);
    await openMode(page, slug);
    await choice(page, "Beta").check();
    await expect(readiness(page, "beta")).toBeVisible();
    await acceptAll(page, "beta");
    await page.getByRole("radio", { name: "Keep them for now" }).check();
    await confirmSwitch(page, slug, "beta");
    await expect(page.getByText(/^Switched to beta\./)).toBeVisible();
    await expect(choice(page, "Beta")).toBeChecked();
    expect((await call("GET", "/hub-config", hostOf(slug))).body.hub.mode).toBe("beta");
    await contentIsStillThere(page, slug);
  });

  test("the confirmation for beta to live says anyone can sign in and offers to email the waitlist", async ({ page }) => {
    const slug = slugs.b;
    const joined = await call("POST", "/waitlist", hostOf(slug), { email: `ld-wait-${run}@example.test` });
    expect(joined.status, JSON.stringify(joined.body)).toBeLessThan(300);

    await adminPage(page, slug);
    await openMode(page, slug);
    await choice(page, "Live").check();
    const lines = consequences(page);
    await expect(lines.getByRole("heading", { name: "What happens when you switch to live" })).toBeVisible();
    await expect(lines).toContainText("Anyone can sign in");
    const tell = lines.getByRole("checkbox", { name: /^Email the 1 person on the waitlist that the hub is open/ });
    await expect(tell).toBeChecked();
    await tell.uncheck();
    await tell.check();
  });

  test("beta to live with a code keeps the content, says the hub switched and tells the waitlist", async ({ page }) => {
    const slug = slugs.b;
    await adminPage(page, slug);
    await openMode(page, slug);
    await choice(page, "Live").check();
    await expect(consequences(page)).toBeVisible();
    // Whatever the list asks to be accepted for this switch.
    if (await readiness(page, "live").count()) await acceptAll(page, "live");
    await confirmSwitch(page, slug, "live");
    await expect(page.getByText(/^Switched to live\./)).toBeVisible();
    await expect(page.getByText(/1 person on the waitlist was told the hub is open/)).toBeVisible();
    expect((await call("GET", "/hub-config", hostOf(slug))).body.hub.mode).toBe("live");
    await contentIsStillThere(page, slug);
  });
});

test.describe("A hub's visitors and new admin after the changes", () => {
  test.use({ viewport: PHONE });

  test("a new admin's first sign-in lands on Next: set up your hub", async ({ page }) => {
    const slug = slugs.c;
    const newAdmin = `ld-new-admin+${slug}@example.test`;
    const host = hostOf(slug);

    // Add them to the roster, with the step-up code a real admin would have emailed.
    const planted = "424242";
    await plantHubCode(slug, adminEmail(slug), planted);
    const added = await call("POST", "/admin/hub/people", host, { admin_emails: [adminEmail(slug), newAdmin], code: planted }, tokens[slug]);
    expect(added.status, JSON.stringify(added.body)).toBe(200);

    await page.addInitScript(() => {
      localStorage.setItem("seen_intro_popup", "true");
      localStorage.setItem("welcome-banner-dismissed-v2", "true");
      sessionStorage.setItem("civic_preview", "1");
    });
    await page.goto(`${originOf(slug)}/`);
    await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
    await page.getByPlaceholder("you@example.com").fill(newAdmin);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const code = page.locator("#auth-code");
    await expect(code).toBeVisible();
    await plantHubCode(slug, newAdmin, "135790");
    await code.fill("135790");
    await page.getByRole("button", { name: "Verify", exact: true }).click();

    // The name step; an admin is shown the policies line instead of a residency oath.
    await expect(page.getByRole("heading", { name: "One last thing" })).toBeVisible();
    await page.locator("#auth-full-name").fill("Newly Added Admin");
    await page.getByRole("button", { name: /^(Join|Continue)$/ }).click();

    await expect(page).toHaveURL(/\/admin\/settings\/sample/);
    await expect(page.getByRole("region", { name: "Next: set up your hub" })).toBeVisible();
  });

  test("the mode notice comes back in full, with the beta message, after the hub moves from demo to beta", async ({ page }) => {
    const slug = slugs.c;
    const host = hostOf(slug);
    await page.addInitScript(() => {
      localStorage.setItem("seen_intro_popup", "true");
      localStorage.setItem("welcome-banner-dismissed-v2", "true");
      sessionStorage.setItem("civic_preview", "1");
    });
    await page.goto(`${originOf(slug)}/`);
    const notice = page.getByTestId("mode-notice");
    await expect(notice).toHaveAttribute("data-state", "full");
    await expect(notice).toHaveAttribute("aria-label", "Demo notice");
    await notice.getByRole("button", { name: /^Close the/ }).click();
    await expect(notice).toHaveAttribute("data-state", "thin");
    await page.reload();
    await expect(page.getByTestId("mode-notice")).toHaveAttribute("data-state", "thin");

    // Move the hub to beta through the API, with everything accepted.
    await makeReady(slug);
    const planted = "246810";
    await plantHubCode(slug, adminEmail(slug), planted);
    const switched = await call("POST", "/admin/hub/mode", host, {
      mode: "beta",
      code: planted,
      accepted: ["name_and_place", "contact_email", "second_admin", "legal_reviewed", "samples"],
    }, tokens[slug]);
    expect(switched.status, JSON.stringify(switched.body)).toBe(200);

    await expect(async () => {
      await page.reload();
      const after = page.getByTestId("mode-notice");
      await expect(after).toHaveAttribute("data-state", "full", { timeout: 2_000 });
      await expect(after).toHaveAttribute("aria-label", "Beta notice");
      await expect(after).toContainText("You're browsing the");
      await expect(after).toContainText("beta.");
    }).toPass({ timeout: 30_000, intervals: [1_000] });
  });
});

test.describe("The Mode page keeps its width in both navigation layouts", () => {
  for (const layout of ["sidebar", "top_tabs"] as const) {
    for (const [label, size] of [["375 px", PHONE], ["1280 px", DESKTOP]] as const) {
      test(`with navigation set to ${layout} at ${label}, the list and consequences show with no sideways scroll and the code button in view`, async ({ page }) => {
        const slug = slugs.a;
        await putSettings(slug, "theme", { "nav.layout": layout });
        try {
          await page.setViewportSize(size);
          await adminPage(page, slug);
          await openMode(page, slug);
          await choice(page, "Beta").check();
          await expect(readiness(page, "beta")).toBeVisible();
          await expect(consequences(page)).toBeVisible();
          await expect(emailCode(page)).toBeVisible();
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
        } finally {
          await putSettings(slug, "theme", { "nav.layout": "" });
        }
      });
    }
  }
});
