/**
 * Members and invites (2026-10-14), at phone width and on a desktop.
 *
 * 1. "N members" and the avatar stack on the home page, for everyone, above
 *    Raise something on a phone; signed in, the count opens the Members page,
 *    and the account menu has Share this hub but not Members. The word cloud
 *    strip says only "Community word cloud".
 * 2. The Members page: names and pattern-avatars, admins marked, no
 *    addresses; a hidden member is absent; signed out, it asks to sign in.
 *    Hiding oneself in Settings takes one switch.
 * 3. "Share this hub": email invites with the message prefilled from the
 *    hub's intro, and the share buttons.
 * 4. The invite email's link: /sign-in#invite=… → Confirm → the join step.
 * Admins see hidden members in Settings → People.
 *
 * One live hub made through the console's Create hub, visited on its own
 * address (<slug>.localhost on the UI's port), and archived after.
 * CIVIC_E2E_SHOTS=<dir> saves a screenshot of each page at each width.
 */

import { createHash } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";

const UI = new URL(process.env.CIVIC_E2E_UI_ORIGIN?.trim() || "http://localhost:5173");
const run = Date.now().toString(36);
const SLUG = `memb-${run}`;
const HUB = `${UI.protocol}//${SLUG}.localhost${UI.port ? `:${UI.port}` : ""}`;
const ADMIN = `memb-admin-${run}@example.test`;
const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 860 };
const SHOTS = process.env.CIVIC_E2E_SHOTS?.trim();

let consoleCookie = "";
let adminToken = "";
let memberToken = "";
let hiderToken = "";

const addr = (label: string) => `memb-${label}-${run}@example.test`;
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

async function visit(page: Page, token?: string): Promise<void> {
  await page.addInitScript((t) => {
    localStorage.setItem("seen_intro_popup", "true");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
    sessionStorage.setItem("civic_preview", "1");
    if (t) localStorage.setItem("civic_auth_token", t);
  }, token ?? "");
}

async function memberNamed(email: string, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const token = await mintSession(SLUG, email);
  await localRest(`users?hub_id=eq.${SLUG}&email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ full_name: name, tos_version_accepted: CURRENT_LEGAL_VERSION, ...extra }),
  });
  return token;
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll).toBeLessThanOrEqual(inner);
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.waitForTimeout(400); // past the modal's fade-in
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  consoleCookie = await mintConsoleSession();
  const res = await consoleCall("POST", "/control/hubs", {
    cookie: consoleCookie,
    body: {
      slug: SLUG,
      hostname: `${SLUG}.localhost`,
      admin_email: ADMIN,
      name: "Members Test Civic Hub",
      jurisdiction_name: "Example County, Ohio",
      jurisdiction_custom: true,
      jurisdiction_type: "county",
      mode: "live",
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  adminToken = await memberNamed(ADMIN, "Jordan Admin");
  memberToken = await memberNamed(addr("avery"), "Avery Lane");
  for (const n of ["Blake Moss", "Casey Ford", "Devon Park"]) await memberNamed(addr(n.split(" ")[0]!.toLowerCase()), n);
  hiderToken = await memberNamed(addr("harper"), "Harper Vale", { hidden_from_members: true });
});

test.afterAll(async () => {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantCode("step_up", code);
  await consoleCall("POST", `/control/hubs/${SLUG}/archive`, { cookie: consoleCookie, body: { step_up_code: code } });
});

for (const [name, viewport] of [["phone", PHONE], ["desktop", DESKTOP]] as const) {
  test(`1. the member count and the avatar stack, signed out and in (${name})`, async ({ page, browser }) => {
    await page.setViewportSize(viewport);
    await visit(page);
    await page.goto(`${HUB}/`);
    const stack = page.getByTestId("member-stack");
    await expect(stack).toContainText("6 members");
    await expect(stack.locator(".pattern-avatar")).toHaveCount(5);
    await expect(stack.getByRole("link")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Share this hub" })).toHaveCount(0);
    // Under the tagline, above Raise something (Adam, 2026-10-14).
    const stackBox = (await stack.boundingBox())!;
    const raiseBox = (await page.getByRole("button", { name: "Raise something" }).boundingBox())!;
    if (name === "phone") expect(stackBox.y).toBeLessThan(raiseBox.y);
    // The word cloud strip is its label only; the prompt is on the word cloud's page.
    await expect(page.getByRole("link", { name: "View the community word cloud" })).toHaveText(/^✦\s*Community word cloud\s*→$/);
    await noSidewaysScroll(page);
    await shot(page, `home-signed-out-${name}`);

    const signedInContext = await browser.newContext();
    const signedIn = await signedInContext.newPage();
    await signedIn.setViewportSize(viewport);
    await visit(signedIn, memberToken);
    await signedIn.goto(`${HUB}/`);
    // The account menu offers Share this hub, not Members (Adam, 2026-10-14).
    await signedIn.getByRole("button", { name: "Account menu" }).click();
    await expect(signedIn.getByRole("menuitem", { name: "Share this hub" })).toBeVisible();
    await expect(signedIn.getByRole("menuitem", { name: "Members" })).toHaveCount(0);
    await signedIn.keyboard.press("Escape");
    await signedIn.getByTestId("member-stack").getByRole("link", { name: "6 members" }).click();
    await expect(signedIn).toHaveURL(/\/members$/);
    await signedInContext.close();
  });

  test(`2. the Members page as a member, and hiding oneself (${name})`, async ({ page, browser }) => {
    await page.setViewportSize(viewport);
    await visit(page, memberToken);
    await page.goto(`${HUB}/members`);
    const list = page.getByRole("list", { name: "Members" });
    await expect(list.getByRole("listitem")).toHaveCount(5);
    await expect(list).toContainText("Avery Lane");
    await expect(list).not.toContainText("Harper Vale");
    await expect(list.getByRole("listitem").filter({ hasText: "Jordan Admin" })).toContainText("Admin");
    await expect(page.getByText("1 member prefers not to be listed.")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("@example.test");
    await noSidewaysScroll(page);
    await shot(page, `members-${name}`);

    // The hidden member is told so, and one switch in Settings shows them again.
    // Their own browser: a session token lives in the origin's localStorage.
    const hiderContext = await browser.newContext({ extraHTTPHeaders: { "X-Forwarded-For": "10.9.8.7" } });
    const hider = await hiderContext.newPage();
    await hider.setViewportSize(viewport);
    await visit(hider, hiderToken);
    await hider.goto(`${HUB}/members`);
    await expect(hider.getByText("You're hidden from this page and the home page.")).toBeVisible();
    await hider.getByRole("link", { name: "Change this in Settings" }).click();
    const toggle = hider.getByLabel("Show me on the Members page");
    await expect(toggle).not.toBeChecked();
    await noSidewaysScroll(hider);
    await shot(hider, `settings-members-${name}`);
    await toggle.check();
    await expect(hider.getByText("Saved. Other members can see your name on the Members page.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("list", { name: "Members" })).toContainText("Harper Vale");
    await toggle.uncheck();
    await expect(hider.getByText(/Saved\. You're off the Members page/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("list", { name: "Members" })).not.toContainText("Harper Vale");
    await hiderContext.close();
  });

  test(`2. signed out, the Members page asks to sign in (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await visit(page);
    await page.goto(`${HUB}/members`);
    await expect(page.getByText("Members can see who else is here.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Members" })).toHaveCount(0);
  });

  test(`3. Share this hub: email invites and the share buttons (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await visit(page, memberToken);
    await page.goto(`${HUB}/`);
    await page.getByRole("button", { name: "Share this hub" }).click();
    const panel = page.getByRole("dialog", { name: "Share this hub" });
    await expect(panel).toBeVisible();
    // The message starts from the hub's intro, and can be changed.
    const message = panel.getByLabel("Your message");
    await expect(message).toHaveValue(/thought you'd want to join too\.$/);
    await panel.getByLabel("Email addresses").fill(`${addr(`friend-a-${name}`)}, ${addr(`friend-b-${name}`)}`);
    await message.fill(`Come to the next one! ${run}`);
    await expect(panel.getByRole("link", { name: "Nextdoor" })).toHaveAttribute("href", /^https:\/\/nextdoor\.com\/sharekit\//);
    await expect(panel.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
    await expect(panel.getByRole("button", { name: "Copy link" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Facebook" })).toHaveCount(1); // not a touch device
    await noSidewaysScroll(page);
    await shot(page, `share-${name}`);
    await panel.getByRole("button", { name: "Send invites" }).click();
    await expect(panel.getByRole("status")).toHaveText("Done: invites sent to 2 addresses.");
    await expect(panel.getByLabel("Email addresses")).toHaveValue("");
    const rows = (await localRest(`hub_invites?select=outcome&hub_id=eq.${SLUG}&email=eq.${encodeURIComponent(addr(`friend-a-${name}`))}`)) as Array<{ outcome: string }>;
    expect(rows).toEqual([{ outcome: "emailed" }]);
  });

  test(`4. the invite link lands a new neighbour on the join step (${name})`, async ({ page }) => {
    const token = `e2e-invite-${run}-${name}-${"z".repeat(32)}`;
    await localRest("hub_invites", {
      method: "POST",
      body: JSON.stringify({
        hub_id: SLUG,
        email: addr(`newcomer-${name}`),
        outcome: "emailed",
        link_hash: sha256(token),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    });
    await page.setViewportSize(viewport);
    await visit(page);
    await page.goto(`${HUB}/sign-in#invite=${token}`);
    await expect(page.getByRole("heading", { name: "Join Members Test Civic Hub" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${HUB}/sign-in$`));
    await noSidewaysScroll(page);
    await shot(page, `invite-link-${name}`);
    await page.getByRole("button", { name: "Confirm" }).click();
    // A new account: the join step asks for a name.
    await expect(page.getByLabel(/name/i).first()).toBeVisible();
    await shot(page, `invite-join-${name}`);
  });
}

test("admins see hidden members in Settings → People, without addresses", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await visit(page, adminToken);
  await page.goto(`${HUB}/admin/settings/people`);
  const hidden = page.getByRole("list", { name: "Hidden members" });
  await expect(hidden).toContainText("Harper Vale");
  await expect(hidden).not.toContainText("@");
  await noSidewaysScroll(page);
  await hidden.scrollIntoViewIfNeeded();
  await shot(page, "admin-hidden-phone");
});
