/**
 * Feedback routing (2026-10-13), at phone width and on a desktop.
 *
 * 1. The form asks what it is about first, then shows that side's pills; a
 *    software report says it is shared with Civic.Social, offers consent when
 *    there is an address, and carries the page the person came from.
 * 2. Routing: a software report lands with the hub and in Civic.Social's
 *    inbox; a hub report lands with the hub only.
 * 3. Admin → Feedback: the badge and Civic.Social's status; "Send to
 *    Civic.Social" for a misfiled item; a digest link lands on its row.
 * 4. Contact Civic.Social from the Admin group (More on a phone, the sidebar on a desktop).
 * 5. The console's inbox: likely duplicates together, the consent flag,
 *    a status that reaches the hub's badge, the GitHub issue link.
 *
 * One beta hub made through the console's Create hub, visited on its own
 * address (<slug>.localhost on the UI's port), and archived after. Needs the
 * console's env on the API (CIVIC_CONSOLE_HOSTNAME=console.localhost).
 */

import { test, expect, type Page } from "@playwright/test";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";

const UI = new URL(process.env.CIVIC_E2E_UI_ORIGIN?.trim() || "http://localhost:5173");
const run = Date.now().toString(36);
const SLUG = `route-${run}`;
const HUB = `${UI.protocol}//${SLUG}.localhost${UI.port ? `:${UI.port}` : ""}`;
const CONSOLE_UI = `${UI.protocol}//console.localhost${UI.port ? `:${UI.port}` : ""}/console.html`;
const ADMIN = `route-admin-${run}@example.test`;
const RESIDENT = `route-resident-${run}@example.test`;
const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 860 };
const SHARED = "Reports about how the site works are also shared with Civic.Social, which maintains the software.";

type Row = Record<string, any>;

let consoleCookie = "";
let adminToken = "";
let residentToken = "";

async function visit(page: Page, token?: string): Promise<void> {
  await page.addInitScript((t) => {
    localStorage.setItem("seen_intro_popup", "true");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
    sessionStorage.setItem("civic_preview", "1");
    if (t) localStorage.setItem("civic_auth_token", t);
  }, token ?? "");
}

async function sessionFor(email: string): Promise<string> {
  const token = await mintSession(SLUG, email);
  await localRest(`users?hub_id=eq.${SLUG}&email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ tos_version_accepted: CURRENT_LEGAL_VERSION }),
  });
  return token;
}

async function hubRows(message: string): Promise<Row[]> {
  return (await localRest(
    `feedback_submissions?select=*&hub_id=eq.${SLUG}&message=eq.${encodeURIComponent(message)}`,
  )) as Row[];
}

async function copies(message: string): Promise<Row[]> {
  return (await localRest(
    `platform_feedback?select=*&source_hub_id=eq.${SLUG}&message=eq.${encodeURIComponent(message)}`,
  )) as Row[];
}

/** Open the form from a page, the way people do: the footer's link. */
async function openFormFrom(page: Page, path: string): Promise<void> {
  await page.goto(`${HUB}${path}`);
  await page.getByRole("contentinfo").getByRole("link", { name: "Send feedback" }).click();
  await expect(page.getByRole("heading", { name: "Send feedback" })).toBeVisible();
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll).toBeLessThanOrEqual(inner);
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
      name: "Routing Test Civic Hub",
      jurisdiction_name: "Example County, Ohio",
      jurisdiction_custom: true,
      jurisdiction_type: "county",
      mode: "beta",
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  adminToken = await sessionFor(ADMIN);
  residentToken = await sessionFor(RESIDENT);
});

test.afterAll(async () => {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantCode("step_up", code);
  await consoleCall("POST", `/control/hubs/${SLUG}/archive`, { cookie: consoleCookie, body: { step_up_code: code } });
});

for (const [name, viewport] of [["phone", PHONE], ["desktop", DESKTOP]] as const) {
  test(`1–2. a software report: the question, the notice, consent, the page; it reaches the hub and Civic.Social (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await visit(page, residentToken);
    await openFormFrom(page, "/about");

    // Nothing to fill until the question is answered.
    await expect(page.getByRole("radio", { name: /^Bug/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send feedback" })).toBeDisabled();

    await page.getByText("How the site works", { exact: true }).click();
    const pills = page.getByRole("radiogroup", { name: "What kind?" }).getByRole("radio");
    await expect(pills).toHaveCount(2);
    await expect(page.getByRole("radiogroup", { name: "What kind?" })).toContainText("Bug");
    await expect(page.getByRole("radiogroup", { name: "What kind?" })).toContainText("Idea");
    await expect(page.getByText(SHARED)).toBeVisible();

    const message = `The about page jumps when it loads (${name}) ${run}`;
    await page.getByLabel(/^Message/).fill(message);
    // Signed in, so there is an address to share: the consent box is there.
    await page.getByLabel("Civic.Social may contact me about this").check();
    await noSidewaysScroll(page);
    await page.getByRole("button", { name: "Send feedback" }).click();
    await expect(page.getByTestId("feedback-shared")).toContainText("also shared with Civic.Social");

    const [row] = await hubRows(message);
    expect(row).toMatchObject({ category: "bug", page_path: "/about", contact_ok: true, mosaic_stream: "bug" });
    const [copy] = await copies(message);
    expect(copy).toMatchObject({ stream: "bug", page_path: "/about", contact_ok: true, contact_email: RESIDENT });
    expect(copy.user_agent).toBeTruthy();
  });

  test(`1–2. a hub report: that side's pills, no notice, the hub only (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await visit(page);
    await openFormFrom(page, "/");

    await page.getByText("This hub", { exact: true }).click();
    const group = page.getByRole("radiogroup", { name: "What kind?" });
    await expect(group.getByRole("radio")).toHaveCount(3);
    await expect(group).toContainText("Suggest a topic");
    await expect(group).toContainText("Moderation");
    await expect(group).toContainText("General");
    await expect(page.getByText(SHARED)).toHaveCount(0);

    // Switching sides keeps the pill on the side chosen.
    await page.getByText("How the site works", { exact: true }).click();
    // Anonymous with no address: no consent box, a line saying how to give one.
    await expect(page.getByLabel("Civic.Social may contact me about this")).toHaveCount(0);
    await page.getByLabel("Email (optional)").fill(`anon-${run}@example.test`);
    await expect(page.getByLabel("Civic.Social may contact me about this")).toBeVisible();
    await page.getByText("This hub", { exact: true }).click();

    const message = `Please add the library board's meetings (${name}) ${run}`;
    await group.getByText("Suggest a topic").click();
    await page.getByLabel(/^Message/).fill(message);
    await page.getByRole("button", { name: "Send feedback" }).click();
    await expect(page.getByRole("heading", { name: "Thanks for the feedback" })).toBeVisible();
    await expect(page.getByTestId("feedback-shared")).toHaveCount(0);

    const [row] = await hubRows(message);
    expect(row).toMatchObject({ category: "topic", mosaic_item_id: null });
    expect(await copies(message)).toHaveLength(0);
  });
}

for (const [name, viewport] of [["phone", PHONE], ["desktop", DESKTOP]] as const) {
  test(`3. Admin → Feedback: the badge, and Send to Civic.Social for a misfiled item (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const misfiled = `The vote button does nothing (${name}) ${run}`;
    const sent = await page.request.post(`${HUB}/api/feedback`, {
      data: { category: "general", message: misfiled, contact_ok: true },
      headers: { Authorization: `Bearer ${residentToken}` },
    });
    expect(sent.ok()).toBe(true);
    const id = (await sent.json()).submission_id as string;

    await visit(page, adminToken);
    // The digest's link: the row, in view.
    await page.goto(`${HUB}/admin/feedback#${id}`);
    const item = page.locator(`[id="${id}"]`);
    await expect(item).toBeInViewport();
    await expect(page.getByRole("main").getByRole("link", { name: "Contact Civic.Social" })).toBeVisible();

    // Shared bugs carry the badge with Civic.Social's status.
    await expect(page.getByTestId("mosaic-badge").first()).toContainText("Sent to Civic.Social");

    await item.getByRole("button", { name: "Send to Civic.Social", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Send to Civic.Social?" });
    await expect(dialog).toContainText("not the sender's name or address");
    await dialog.getByLabel("Something broken (a bug)").check();
    await noSidewaysScroll(page);
    await dialog.getByRole("button", { name: "Send", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(item.getByTestId("mosaic-badge")).toContainText("Received");
    await expect(item.getByRole("button", { name: "Send to Civic.Social", exact: true })).toHaveCount(0);

    const [copy] = await copies(misfiled);
    expect(copy).toMatchObject({ origin: "forwarded", stream: "bug", contact_ok: false, contact_email: null });
  });

  test(`4. Contact Civic.Social from the Admin menu (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await visit(page, adminToken);
    await page.goto(`${HUB}/`);
    if (name === "phone") {
      // Phones: More's Admin group (navigation slice, 2026-10-14).
      await page.getByRole("navigation", { name: "Sections", exact: true }).locator('[data-nav-id="more"]').click();
      await page.getByTestId("more-sheet").getByRole("link", { name: "Contact Civic.Social" }).click();
    } else {
      // A new hub's desktop has top navigation (design pass, decision 6): the Admin menu.
      await page.getByRole("button", { name: "Admin", exact: true }).click();
      await page.getByRole("menuitem", { name: "Contact Civic.Social" }).click();
    }
    await expect(page).toHaveURL(/\/admin\/contact-civic-social$/);
    await expect(page.getByText(ADMIN)).toBeVisible();

    // Its "?" note, from the registry, linking to the docs.
    await page.getByRole("button", { name: "About Contact Civic.Social" }).click();
    const note = page.getByRole("note");
    await expect(note).toContainText("apart from residents' feedback");
    await expect(note.getByRole("link")).toHaveAttribute("href", /^https:\/\/docs\.civic\.social\/reference\/plugins/);
    await page.keyboard.press("Escape");
    await expect(note).toBeHidden();

    const message = `How do I move our hub to a new address? (${name}) ${run}`;
    await page.getByLabel(/^Message/).fill(message);
    await noSidewaysScroll(page);
    await page.getByRole("button", { name: "Send to Civic.Social", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(`Civic.Social will reply to ${ADMIN}`);

    const [copy] = await copies(message);
    expect(copy).toMatchObject({ stream: "admin", origin: "admin", contact_email: ADMIN, source_feedback_id: null });
    expect(await hubRows(message)).toHaveLength(0);
  });
}

for (const [name, viewport] of [["phone", PHONE], ["desktop", DESKTOP]] as const) {
  test(`5. the console's inbox: duplicates together, consent, status back to the badge, the issue link (${name})`, async ({ page, context }) => {
    await page.setViewportSize(viewport);
    const page1 = `Map tiles stay blank on the projects map (${name}) ${run}`;
    const page2 = `The projects map tiles stay blank (${name}) ${run}`;
    for (const message of [page1, page2]) {
      const res = await page.request.post(`${HUB}/api/feedback`, {
        data: { category: "bug", message, page_path: `/projects/map-${name}-${run}` },
      });
      expect(res.ok()).toBe(true);
    }
    const hubId = (await hubRows(page1))[0].id as string;

    const [cname, value] = consoleCookie.split("=");
    await context.addCookies([{ name: cname, value: decodeURIComponent(value), domain: "console.localhost", path: "/" }]);
    await page.goto(`${CONSOLE_UI}#/feedback`);
    await expect(page.getByRole("heading", { name: "Feedback" })).toBeVisible();
    await page.getByRole("button", { name: "Bugs" }).click();

    const group = page.getByTestId("feedback-group").filter({ hasText: page1 });
    await expect(group).toContainText("2 likely duplicates");
    await expect(group).toContainText(page2);
    await expect(group).toContainText("Routing Test Civic Hub");
    // No consent: no address.
    await expect(group.getByTestId("feedback-contact").first()).toHaveText("No consent to contact");
    await noSidewaysScroll(page);

    const card = group.getByTestId("feedback-item").filter({ hasText: page1 });
    await card.getByLabel(/^Status of this bug/).selectOption("planned");
    await expect.poll(async () => (await hubRows(page1))[0].mosaic_status).toBe("planned");
    await card.getByLabel("GitHub issue").fill("https://github.com/Mosaic-Foundation/civic-hub/issues/4242");
    await card.getByRole("button", { name: "Save link" }).click();
    await expect(card.getByRole("status")).toHaveText("Issue link saved.");
    await expect(card.getByRole("link", { name: "Open issue" })).toBeVisible();

    // The hub's admin sees Planned on the badge, and not the issue link.
    const admin = await context.newPage();
    await admin.setViewportSize(viewport);
    await visit(admin, adminToken);
    await admin.goto(`${HUB}/admin/feedback#${hubId}`);
    const row = admin.locator(`[id="${hubId}"]`);
    await expect(row.getByTestId("mosaic-badge")).toContainText("Planned");
    await expect(admin.getByText("issues/4242")).toHaveCount(0);
  });
}
