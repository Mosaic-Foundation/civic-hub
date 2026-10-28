/**
 * Events, the calendar plugin (packages/civic.event), in the browser, at phone
 * width and on a desktop.
 *
 *   1. A resident on a demo hub adds an event (a place with an address) and
 *      lands on its page, which shows the time and the address.
 *   2. A resident on a beta hub submits one and is told it is with the admins;
 *      an admin approves it in the review queue; it is on the calendar.
 *   3. A resident says they're going (0 to 1, the button turns into "I'm not
 *      going"); taking it back returns the count to 0.
 *   4. The calendar lists upcoming events by day with past ones below, and
 *      Events is a section in the navigation after Votes.
 *   5. The creator cancels an event: its page says so and the calendar marks
 *      it Cancelled.
 *
 * The demo hub is Athens, which publishes a resident's submission at once; the
 * beta hub is Floyd, which holds it for an admin (as feedStream.spec.ts does,
 * each is reached at http://<hub>.localhost:<the UI's port>). Both are the
 * local stack's fixture hubs, with sessions written into the LOCAL stack. The
 * plugin is installed on each first (installing again changes nothing). Every
 * event is made here, with a title unique to the run, at a time a few days
 * ahead computed when the run starts; the datetime-local fields take local
 * "YYYY-MM-DDTHH:MM" strings, and the page's own dates are read back from the
 * browser's formatting, so no locale or time zone is assumed.
 *
 * The one event that has to be past (test 4) cannot be made through the form,
 * which refuses a time already over; its calendar row is moved back instead.
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { localRest } from "../fixtures/adminSession.js";
import { adminEmailFor, run, session, visitAs } from "./actors";

const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 900 };
const VIEWPORTS = [
  { label: "phone", size: PHONE },
  { label: "desktop", size: DESKTOP },
] as const;

const DEMO = "athens";
const BETA = "floyd";
const PORT = new URL(process.env.CIVIC_E2E_BASE_URL?.trim() || "http://localhost:5173").port || "80";
const originOf = (hub: string) => `http://${hub}.localhost:${PORT}`;
// Through the page's own origin when it proxies /api (a preview build), else the API itself.
const apiOf = (hub: string) => (process.env.CIVIC_E2E_BASE_URL ? `${originOf(hub)}/api` : "http://localhost:3000");
const headers = (hub: string, token: string) => ({
  Authorization: `Bearer ${token}`,
  ...(process.env.CIVIC_E2E_BASE_URL ? {} : { Host: `${hub}.localhost` }),
});

const ADDRESS = "1 Example Street";
const TOWN = "Exampletown";
const VENUE = "Community room";

/** A local "YYYY-MM-DDTHH:MM" some days from today, at this hour and minute. */
function localTime(daysAhead: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, minute, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The day heading and the clock time the page shows for a local time, formatted by the browser as the page does. */
async function shown(page: Page, local: string): Promise<{ day: string; time: string }> {
  const iso = new Date(local).toISOString();
  return page.evaluate((i) => {
    const d = new Date(i);
    return {
      day: d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
      time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    };
  }, iso);
}

interface Made {
  id: string;
  title: string;
}

/** An event made the way the form makes it (a draft, filled, submitted), through the hub's routes. Must be approved at once. */
async function makeEvent(
  request: APIRequestContext,
  hub: string,
  token: string,
  title: string,
  start: string,
  end: string,
): Promise<Made> {
  const base = apiOf(hub);
  const h = headers(hub, token);
  const draft = await request.post(`${base}/calendar/drafts`, { headers: h, data: {} });
  expect(draft.status(), await draft.text()).toBe(201);
  const { id } = (await draft.json()) as { id: string };
  const filled = await request.patch(`${base}/calendar/drafts/${id}`, {
    headers: h,
    data: {
      title,
      description: "An evening to meet the neighbours.",
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      venue: VENUE,
      street_address: ADDRESS,
      locality: TOWN,
    },
  });
  expect(filled.ok(), await filled.text()).toBe(true);
  const submitted = await request.post(`${base}/calendar/drafts/${id}/submit`, { headers: h, data: {} });
  expect(submitted.status(), await submitted.text()).toBe(201);
  const body = (await submitted.json()) as { process_id?: string; auto_approved?: boolean };
  expect(body.auto_approved).toBe(true);
  return { id: body.process_id!, title };
}

const tokens: Record<string, { admin: string; adminId: string }> = {};

test.beforeAll(async ({ request }) => {
  test.setTimeout(60_000);
  for (const hub of [DEMO, BETA]) {
    const admin = await session(hub, adminEmailFor(hub));
    tokens[hub] = { admin: admin.token, adminId: admin.userId };
    const res = await request.post(`${apiOf(hub)}/admin/hub/plugins/events/install`, { headers: headers(hub, admin.token), data: {} });
    expect(res.ok(), await res.text()).toBe(true);
  }
});

/**
 * A fresh resident of the demo hub to submit events as: each submission runs
 * the Code of Conduct check, counted per person per hour, so no one person
 * makes them all.
 */
async function maker(label: string): Promise<string> {
  return (await session(DEMO, `events-maker-${label}-${run}@example.test`)).token;
}

async function residentOn(hub: string, label: string, page: Page): Promise<string> {
  const { token } = await session(hub, `events-${label}-${run}@example.test`);
  await visitAs(page, token);
  return token;
}

for (const vp of VIEWPORTS) {
  test.describe(`Events at ${vp.label} width`, () => {
    test.use({ viewport: vp.size });

    test("a resident on the demo hub adds an event and lands on its page, which shows the time and the address", async ({ page }) => {
      await residentOn(DEMO, `add-${vp.label}`, page);
      const title = `Demo hub picnic ${vp.label} ${run}`;
      const start = localTime(4, 17, 30);
      const end = localTime(4, 19, 0);

      await page.goto(`${originOf(DEMO)}/events`);
      await page.getByRole("link", { name: "Add an event" }).click();
      await expect(page).toHaveURL(/\/events\/new$/);
      await expect(page.getByRole("heading", { level: 1, name: "New event" })).toBeVisible();

      await page.getByRole("textbox", { name: "Name", exact: true }).fill(title);
      await page.getByRole("textbox", { name: "What it is", exact: true }).fill("An evening to meet the neighbours.");
      await page.getByRole("textbox", { name: "Starts", exact: true }).fill(start);
      await page.getByRole("textbox", { name: "Ends", exact: true }).fill(end);
      await page.getByRole("radio", { name: "A place" }).check();
      await page.getByRole("textbox", { name: "Place", exact: true }).fill(VENUE);
      await page.getByText("Street address", { exact: false }).first().click();
      await page.getByRole("textbox", { name: "Street", exact: true }).fill(ADDRESS);
      await page.getByRole("textbox", { name: "Town or city", exact: true }).fill(TOWN);
      await page.getByRole("button", { name: "Submit" }).click();

      // A demo hub publishes it at once: the page, not a waiting note.
      await expect(page).toHaveURL(/\/events\/(?!new$)[^/]+$/);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      const s = await shown(page, start);
      const e = await shown(page, end);
      const facts = page.locator(".ev-facts");
      await expect(facts).toContainText(s.day);
      await expect(facts).toContainText(s.time);
      await expect(facts).toContainText(e.time);
      await expect(facts).toContainText(`${VENUE}, ${ADDRESS}, ${TOWN}`);
      await expect(page.getByTestId("going-count")).toHaveText("0 people are going");
    });

    test("a resident on the beta hub submits an event, sees it is with the admins, an admin approves it, and it is on the calendar", async ({ page, browser }) => {
      await residentOn(BETA, `beta-${vp.label}`, page);
      const title = `Beta hub meeting ${vp.label} ${run}`;

      await page.goto(`${originOf(BETA)}/events/new`);
      await page.getByRole("textbox", { name: "Name", exact: true }).fill(title);
      await page.getByRole("textbox", { name: "Starts", exact: true }).fill(localTime(5, 18, 0));
      await page.getByRole("textbox", { name: "Ends", exact: true }).fill(localTime(5, 19, 30));
      await page.getByRole("textbox", { name: "Place", exact: true }).fill(VENUE);
      await page.getByRole("button", { name: "Submit" }).click();

      await expect(page.getByRole("status")).toContainText("Thank you. Your event is with the hub's admins");
      await page.getByRole("link", { name: "Back to the calendar" }).click();
      await expect(page).toHaveURL(/\/events$/);
      await expect(page.getByRole("heading", { level: 1, name: "Events" })).toBeVisible();
      // Not there yet: nobody has approved it.
      await expect(page.getByText(title)).toHaveCount(0);

      // An admin finds it in the review queue and approves it, in a browser of
      // their own (two sessions' init scripts on one page run in no set order).
      const context = await browser.newContext({ viewport: vp.size });
      const admin = await context.newPage();
      await visitAs(admin, tokens[BETA]!.admin);
      await admin.goto(`${originOf(BETA)}/admin/reviews`);
      await admin.locator(".process-card", { hasText: title }).click();
      await expect(admin).toHaveURL(/\/admin\/reviews\/[^/]+$/);
      await admin.getByRole("button", { name: "Approve & post" }).click();
      await expect(admin).toHaveURL(/\/admin\/reviews$/);
      await expect(admin.getByRole("status").filter({ hasText: `Approved: “${title}” is live.` })).toBeVisible();
      await context.close();

      await page.goto(`${originOf(BETA)}/events`);
      const item = page.locator(".ev-item", { hasText: title });
      await expect(item).toBeVisible();
      await expect(item).toContainText(VENUE);
    });

    test("a resident says they're going, the count goes from 0 to 1, and taking it back returns it to 0", async ({ request, page }) => {
      const event = await makeEvent(
        request, DEMO, await maker(`going-${vp.label}`), `Going to this ${vp.label} ${run}`, localTime(6, 10, 0), localTime(6, 11, 0),
      );
      await residentOn(DEMO, `going-${vp.label}`, page);
      await page.goto(`${originOf(DEMO)}/events/${event.id}`);

      const count = page.getByTestId("going-count");
      await expect(count).toHaveText("0 people are going");
      await page.getByRole("button", { name: "I'm going" }).click();
      await expect(count).toHaveText("1 person is going");
      // Who is going, as the hub discloses it (engine 2, A3): a member sees the name.
      await expect(page.getByTestId("going-names")).toHaveText(/\S/);
      await expect(page.getByRole("button", { name: "I'm not going" })).toBeVisible();
      await expect(page.getByRole("button", { name: "I'm going", exact: true })).toHaveCount(0);

      // It is the hub's record, not the page's: a reload shows it too.
      await page.reload();
      await expect(count).toHaveText("1 person is going");

      await page.getByRole("button", { name: "I'm not going" }).click();
      await expect(count).toHaveText("0 people are going");
      await expect(page.getByRole("button", { name: "I'm going", exact: true })).toBeVisible();
    });

    test("the calendar lists upcoming events by day with past ones below", async ({ request, page }) => {
      const admin = await maker(`calendar-${vp.label}`);
      const first = await makeEvent(request, DEMO, admin, `Calendar morning ${vp.label} ${run}`, localTime(8, 9, 0), localTime(8, 10, 0));
      const second = await makeEvent(request, DEMO, admin, `Calendar evening ${vp.label} ${run}`, localTime(8, 18, 0), localTime(8, 19, 0));
      const later = await makeEvent(request, DEMO, admin, `Calendar next day ${vp.label} ${run}`, localTime(9, 12, 0), localTime(9, 13, 0));
      const past = await makeEvent(request, DEMO, admin, `Calendar over ${vp.label} ${run}`, localTime(10, 12, 0), localTime(10, 13, 0));
      // The form refuses a time already over, so this one is moved back where the calendar reads it.
      const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
      const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
      await localRest(`calendar_events?hub_id=eq.${DEMO}&process_id=eq.${past.id}`, {
        method: "PATCH",
        body: JSON.stringify({ start_time: twoHoursAgo, end_time: hourAgo }),
      });

      await residentOn(DEMO, `calendar-${vp.label}`, page);
      await page.goto(`${originOf(DEMO)}/events`);
      await expect(page.getByRole("heading", { level: 1, name: "Events" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Subscribe in your calendar app" })).toHaveAttribute("href", "/api/calendar/hub.ics");

      // Two events share a day, in time order; the other has a day of its own.
      const day8 = (await shown(page, localTime(8, 9, 0))).day;
      const day9 = (await shown(page, localTime(9, 12, 0))).day;
      const sameDay = page.getByRole("region", { name: day8, exact: true });
      await expect(sameDay.getByRole("heading", { level: 2, name: day8 })).toBeVisible();
      // Only this test's own (the other width's run makes events on the same days).
      const mine = `${vp.label} ${run}`;
      await expect(sameDay.locator(".ev-item", { hasText: mine })).toHaveText([
        new RegExp(`${first.title}`),
        new RegExp(`${second.title}`),
      ]);
      await expect(sameDay.locator(".ev-item", { hasText: mine }).first()).toContainText((await shown(page, localTime(8, 9, 0))).time);
      const nextDay = page.getByRole("region", { name: day9, exact: true });
      await expect(nextDay.locator(".ev-item", { hasText: mine })).toHaveText([new RegExp(`${later.title}`)]);
      // Days come in order down the page.
      const headings = await page.locator(".ev-day-heading").allTextContents();
      expect(headings.indexOf(day8)).toBeGreaterThanOrEqual(0);
      expect(headings.indexOf(day9)).toBeGreaterThan(headings.indexOf(day8));

      // The past one is not in a day's list: it is below, behind "Past events (N)".
      await expect(page.locator(".ev-day .ev-item", { hasText: past.title })).toHaveCount(0);
      const pastList = page.locator("details.ev-past");
      await expect(pastList.locator("summary")).toHaveText(/^Past events \(\d+\)$/);
      await expect(pastList.locator(".ev-item", { hasText: past.title })).toBeHidden();
      await pastList.locator("summary").click();
      await expect(pastList.locator(".ev-item", { hasText: past.title })).toBeVisible();
      const pastBox = await pastList.boundingBox();
      const lastDay = await page.locator(".ev-day").last().boundingBox();
      expect(pastBox!.y).toBeGreaterThan(lastDay!.y);
    });

    test("Events is a section in the navigation, after Votes", async ({ page }) => {
      await residentOn(DEMO, `nav-${vp.label}`, page);
      await page.goto(`${originOf(DEMO)}/votes`);
      if (vp.label === "phone") {
        // The bottom bar keeps four sections and More; the sheet lists every one.
        const bar = page.getByRole("navigation", { name: "Sections", exact: true });
        await bar.locator('[data-nav-id="more"]').click();
        const sheet = page.getByTestId("more-sheet");
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole("link", { name: "Events", exact: true })).toBeVisible();
        const labels = await sheet.getByRole("link").allTextContents();
        const names = labels.map((l) => l.trim());
        expect(names.indexOf("Events")).toBeGreaterThan(names.indexOf("Votes"));
        await sheet.getByRole("link", { name: "Events", exact: true }).click();
      } else {
        await expect(page.locator(".feed-votes-tabs").getByRole("link", { name: "Events", exact: true })).toBeVisible();
        const tabs = page.locator(".feed-votes-tabs-list li");
        const names = (await tabs.allTextContents()).map((l) => l.trim());
        expect(names.indexOf("Votes")).toBeGreaterThanOrEqual(0);
        expect(names.indexOf("Events")).toBeGreaterThan(names.indexOf("Votes"));
        await page.locator(".feed-votes-tabs").getByRole("link", { name: "Events", exact: true }).click();
      }
      await expect(page).toHaveURL(/\/events$/);
      await expect(page.getByRole("heading", { level: 1, name: "Events" })).toBeVisible();
    });

    test("the creator edits an event through the hub's edit path: its name, time and place change on its page", async ({ request, page }) => {
      const label = `edit-${vp.label}`;
      const token = await residentOn(DEMO, label, page);
      const event = await makeEvent(request, DEMO, token, `Edited gathering ${vp.label} ${run}`, localTime(7, 10, 0), localTime(7, 11, 0));
      const renamed = `Renamed gathering ${vp.label} ${run}`;

      await page.goto(`${originOf(DEMO)}/events/${event.id}`);
      await page.getByRole("button", { name: "Edit event", exact: true }).click();
      await expect(page).toHaveURL(/\/events\/new\?draft=.*edit=/);
      await expect(page.getByRole("heading", { level: 1, name: "Edit event" }).first()).toBeAttached();
      const name = page.getByRole("textbox", { name: "Name", exact: true });
      await expect(name).toHaveValue(event.title);
      await name.fill(renamed);
      await page.getByRole("textbox", { name: "Place", exact: true }).fill("The library");
      await page.getByRole("button", { name: "Save" }).click();

      await expect(page).toHaveURL(new RegExp(`/events/${event.id}$`));
      await expect(page.getByRole("heading", { level: 1, name: renamed })).toBeVisible();
      await expect(page.locator(".ev-facts")).toContainText("The library");
    });

    test("the creator cancels an event: its page says it was cancelled and the calendar marks it Cancelled", async ({ request, page }) => {
      const label = `cancel-${vp.label}`;
      const token = await residentOn(DEMO, label, page);
      const event = await makeEvent(
        request, DEMO, token, `Cancelled gathering ${vp.label} ${run}`, localTime(7, 16, 0), localTime(7, 17, 0),
      );
      const reason = "The room is no longer available.";

      await page.goto(`${originOf(DEMO)}/events/${event.id}`);
      await expect(page.getByRole("heading", { level: 1, name: event.title })).toBeVisible();
      await expect(page.getByRole("button", { name: "Edit event", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Cancel event", exact: true }).click();
      await page.getByRole("textbox", { name: "Why (shown on the event)" }).fill(reason);
      await page.getByRole("button", { name: "Cancel the event", exact: true }).click();

      await expect(page.getByRole("status").filter({ hasText: "This event was cancelled." })).toContainText(reason);
      await expect(page.getByText("The event is cancelled. It stays on the calendar, marked cancelled.")).toBeVisible();
      // Over: nothing more to say about going, or to change.
      await expect(page.getByRole("button", { name: "I'm going" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Cancel event", exact: true })).toHaveCount(0);

      await page.goto(`${originOf(DEMO)}/events`);
      const item = page.locator(".ev-item", { hasText: event.title });
      await expect(item).toBeVisible();
      await expect(item.locator(".ev-pill")).toHaveText("Cancelled");
    });
  });
}
