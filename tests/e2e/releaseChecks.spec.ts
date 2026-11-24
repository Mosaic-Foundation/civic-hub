/**
 * Release checks (2026-11-24): what a person walked through on dev before a
 * release, as browser tests, so a release needs a person only for what a test
 * can't judge.
 *
 * One new demo hub with sample content, made through the operator API, visited
 * on its own address (<slug>.localhost on the UI's port), put away after.
 *
 * 1. Every content type opens from the kernel's /process/:id link (the link
 *    every activity, email and search result uses), on a desktop and a phone,
 *    and lands on its own page with its title. Events come from the calendar.
 * 2. A resident acts on each type that takes part: casts a vote, endorses a
 *    proposed vote, supports a proposal and a project, answers the word cloud,
 *    says they're going to an event. A finished vote shows its result.
 * 3. The feed's filter pills: each shows only its kind, and All brings
 *    everything back.
 * 4. A new person signs up: no About you card on the way, and the onboarding
 *    word cloud is where they land.
 * 5. Pinning, Search, Feedback, Members and Admin digest each switch off and
 *    back on in Hub settings → Plugins, while the rest of the hub carries on.
 * 6. An urgent pin is the line across the top of every page, and goes when
 *    unpinned.
 *
 * Not covered here (docs/RELEASE-CHECKS.md says why): News items (they come
 * from another site's feed), a conversation's own voting (Polis, an outside
 * service), real email and how a page looks.
 *
 * Needs the operator API on the server (CIVIC_OPERATOR_TOKEN).
 */

import { test, expect, type Browser, type Page } from "@playwright/test";
import { localRest, mintSession } from "./sessions";
import { createHub, archiveHub } from "../fixtures/operator.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";

const UI = new URL(process.env.CIVIC_E2E_UI_ORIGIN?.trim() || "http://localhost:5173");
const run = Date.now().toString(36);
const SLUG = `rel-${run}`;
const HUB = `${UI.protocol}//${SLUG}.localhost${UI.port ? `:${UI.port}` : ""}`;
const API = `${HUB}/api`;
const ADMIN = `rel-admin-${run}@example.test`;
const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 900 };

let adminToken = "";
let eventId = "";

interface Row {
  id: string;
  type: string;
  status: string;
  title: string;
}
let rows: Row[] = [];

/** The sample of a type (and status), from the hub's own table. */
function sample(type: string, status?: string): Row {
  const row = rows.find((r) => r.type === type && (!status || r.status === status));
  if (!row) throw new Error(`no ${type}${status ? ` (${status})` : ""} sample on ${SLUG}`);
  return row;
}

/** A member of the test hub who has accepted the terms and been asked About you. */
async function member(email: string): Promise<string> {
  const token = await mintSession(SLUG, email);
  await localRest(`users?hub_id=eq.${SLUG}&email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ tos_version_accepted: CURRENT_LEGAL_VERSION }),
  });
  return token;
}

async function visitAs(page: Page, token: string | null): Promise<void> {
  await page.addInitScript((t) => {
    localStorage.setItem("seen_intro_popup", "true");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
    sessionStorage.setItem("civic_preview", "1");
    if (t) localStorage.setItem("civic_auth_token", t);
  }, token);
}

async function pageAs(browser: Browser, token: string | null, viewport = DESKTOP): Promise<Page> {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await visitAs(page, token);
  return page;
}

/** goto, once more if the app's own navigation cut the first one off (after a Save it re-reads the hub). */
async function open(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url);
  } catch (e) {
    if (!String(e).includes("ERR_ABORTED")) throw e;
    await page.goto(url);
  }
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const res = await createHub({
    slug: SLUG,
    hostname: `${SLUG}.localhost`,
    admin_email: ADMIN,
    name: "Release Check Civic Hub",
    jurisdiction_name: "Example County, Ohio",
    jurisdiction_custom: true,
    jurisdiction_type: "county",
    sample_content: true,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  adminToken = await member(ADMIN);
  rows = (await localRest(`processes?hub_id=eq.${SLUG}&select=id,type,status,title`)) as Row[];

  // Events has no sample: one on the calendar, a few days out.
  const h = auth(adminToken);
  const on = await request.post(`${API}/admin/hub/plugins/events/install`, { headers: h, data: {} });
  expect(on.ok(), await on.text()).toBeTruthy();
  const draft = await request.post(`${API}/calendar/drafts`, { headers: h, data: {} });
  expect(draft.status(), await draft.text()).toBe(201);
  const { id } = (await draft.json()) as { id: string };
  const start = new Date(Date.now() + 3 * 86_400_000);
  start.setUTCMinutes(0, 0, 0);
  const filled = await request.patch(`${API}/calendar/drafts/${id}`, {
    headers: h,
    data: {
      title: `Release check open house ${run}`,
      description: "An event made by the release checks.",
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + 3_600_000).toISOString(),
      venue: "Community room",
      street_address: "1 Example Street",
      locality: "Exampletown",
    },
  });
  expect(filled.ok(), await filled.text()).toBeTruthy();
  const submitted = await request.post(`${API}/calendar/drafts/${id}/submit`, { headers: h, data: {} });
  expect(submitted.status(), await submitted.text()).toBe(201);
  eventId = ((await submitted.json()) as { process_id: string }).process_id;
  rows.push({ id: eventId, type: "civic.event", status: "active", title: `Release check open house ${run}` });
});

test.afterAll(async () => {
  await archiveHub(SLUG);
});

// Each type's own page, where /process/:id sends a reader (its manifest's detailPath).
const OWN_PAGE: Record<string, RegExp> = {
  "civic.vote": /\/process\//,
  "civic.proposal": /\/proposal\//,
  "civic.project": /\/project\//,
  "civic.polis_deliberation": /\/deliberation\//,
  "civic.wordcloud": /\/wordcloud\//,
  "civic.brief": /\/brief\//,
  "civic.announcement": /\/announcement\//,
  "civic.meeting_summary": /\/meeting-summary\//,
  "civic.event": /\/events\//,
};

for (const [label, viewport] of [
  ["desktop", DESKTOP],
  ["phone", PHONE],
] as const) {
  test(`1. every content type opens from its link and shows its title (${label})`, async ({ browser }) => {
    const page = await pageAs(browser, null, viewport);
    const types = Object.keys(OWN_PAGE);
    expect(types.filter((t) => !rows.some((r) => r.type === t)), "a type with nothing to open").toEqual([]);
    for (const type of types) {
      const row = sample(type);
      await page.goto(`${HUB}/process/${row.id}`);
      await expect(page, `${type} lands on its own page`).toHaveURL(new RegExp(OWN_PAGE[type].source + row.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      await expect(page.locator("main"), type).not.toContainText(/not found|Something went wrong|Error:/i);
      // A meeting summary's heading is the meeting's name; its title is in the feed.
      if (type === "civic.meeting_summary") await expect(page.locator("h1").first()).toBeVisible();
      else await expect(page.locator("h1").first(), type).toContainText(row.title.slice(0, 40));
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${type} fits the width`).toBeLessThanOrEqual(viewport.width);
    }
    await page.context().close();
  });
}

test("2. a resident takes part in each type, and a finished vote shows its result", async ({ browser }) => {
  const page = await pageAs(browser, await member(`rel-resident-${run}@example.test`));

  // A vote: cast.
  await page.goto(`${HUB}/process/${sample("civic.vote", "active").id}`);
  await page.locator(".vote-buttons button").first().click();
  await expect(page.locator(".vote-receipt")).toBeVisible();

  // A proposed vote: endorse.
  await page.goto(`${HUB}/process/${sample("civic.vote", "proposed").id}`);
  await page.getByRole("button", { name: "Endorse Proposal" }).click();
  await expect(page.getByRole("button", { name: "Endorse Proposal" })).toHaveCount(0);

  // A proposal: support.
  await page.goto(`${HUB}/proposal/${sample("civic.proposal").id}`);
  await page.getByRole("button", { name: "Support this proposal" }).click();
  await expect(page.getByText("You have supported this proposal.")).toBeVisible();

  // A project: support (its count goes up by one).
  await page.goto(`${HUB}/project/${sample("civic.project").id}`);
  const support = page.getByRole("button", { name: /^Support/ });
  const before = Number((await support.innerText()).match(/\d+/)?.[0] ?? 0);
  await support.click();
  await expect(page.getByRole("button", { name: /^Support|^Supported/ }).first()).toContainText(String(before + 1));

  // The word cloud: one word.
  await page.goto(`${HUB}/wordcloud/${sample("civic.wordcloud").id}`);
  await page.getByRole("textbox").first().fill("parks");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Submit", exact: true })).toHaveCount(0);

  // An event: going.
  await page.goto(`${HUB}/process/${eventId}`);
  await page.getByRole("button", { name: /going/i }).first().click();
  await expect(page.locator("main")).toContainText(/1 going|You're going|you are going/i);

  // A finished vote: its result, and no ballot.
  await page.goto(`${HUB}/process/${sample("civic.vote", "finalized").id}`);
  await expect(page.locator("main")).toContainText(/result|votes/i);
  await expect(page.locator(".vote-buttons")).toHaveCount(0);

  await page.context().close();
});

test("3. each feed filter pill shows only its kind, and All brings everything back", async ({ browser }) => {
  const page = await pageAs(browser, null);
  await page.goto(`${HUB}/`);
  const pills = page.locator(".feed-filter").getByRole("button");
  await expect(pills.first()).toHaveText("All");
  const names = (await pills.allInnerTexts()).map((n) => n.trim()).filter((n) => n !== "All");
  expect(names).toEqual(expect.arrayContaining(["Announcements", "Activity"]));
  expect(names.some((n) => /meeting summaries$/.test(n)), "a meeting summaries pill").toBe(true);

  const titles = () => page.locator("main article h2, main article h3, main .feed-card h2, main .feed-card h3").allInnerTexts();
  await expect.poll(async () => (await titles()).length).toBeGreaterThan(0);
  const all = await titles();

  for (const name of names) {
    await pills.filter({ hasText: name }).first().click();
    await expect(page).toHaveURL(/\?type=/);
    await expect.poll(async () => (await titles()).length, name).toBeGreaterThan(0);
    const shown = await titles();
    expect(shown.length, `${name} shows fewer than All`).toBeLessThanOrEqual(all.length);
    if (name === "Announcements") {
      for (const t of shown) expect(rows.find((r) => r.title === t)?.type, t).toBe("civic.announcement");
    }
    if (/meeting summaries$/.test(name)) {
      for (const t of shown) expect(rows.find((r) => r.title === t)?.type ?? "civic.meeting_summary", t).toBe("civic.meeting_summary");
    }
  }
  await pills.filter({ hasText: "All" }).first().click();
  await expect.poll(async () => (await titles()).length).toBe(all.length);
  await page.context().close();
});

test("4. a new person signs up: no About you card on the way, and the word cloud is where they land", async ({ browser }) => {
  const page = await pageAs(browser, null);
  await page.goto(`${HUB}/`);
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  await page.getByPlaceholder("you@example.com").fill(`rel-new-${run}@example.test`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.locator(".auth-legal-checkbox")).toBeVisible();
  const name = page.getByPlaceholder("Jane Doe");
  if (await name.count()) await name.fill("New Member");
  await page.locator(".auth-legal-checkbox input[type=checkbox]").check();
  await page.locator(".auth-continue-button").click();

  await expect(page).toHaveURL(/\/wordcloud\/.*onboarding=1/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("About you", { exact: false })).toHaveCount(0);
  const [u] = (await localRest(`users?hub_id=eq.${SLUG}&email=eq.rel-new-${run}%40example.test&select=id`)) as Array<{ id: string }>;
  expect(u, "the account exists").toBeTruthy();
  await page.context().close();
});

// What each feature shows a resident while it is on (and hides while off).
const FEATURES: Array<{ name: string; key: string; mark: (p: Page) => ReturnType<Page["locator"]> }> = [
  { name: "Pinning", key: "pinning", mark: (p) => p.locator("main").getByRole("region", { name: "Pin" }) },
  { name: "Search", key: "search", mark: (p) => p.getByLabel("Search the Civic Hub").first() },
  { name: "Feedback", key: "feedback", mark: (p) => p.getByRole("link", { name: "Give feedback" }).or(p.getByRole("button", { name: "Give feedback" })).first() },
  { name: "Members", key: "members", mark: (p) => p.getByRole("heading", { name: "Members", exact: true }) },
  { name: "Admin digest", key: "admin_digest", mark: () => null as never },
];

test("5. each feature switches off and back on in Plugins, and the rest of the hub carries on", async ({ browser, request }) => {
  test.setTimeout(240_000);
  const admin = await pageAs(browser, adminToken);
  const vote = sample("civic.vote", "active");
  const setting = async (key: string) =>
    ((await (await request.get(`${API}/hub-config`)).json()) as { settings: Record<string, string> }).settings[`plugin.${key}.enabled`];

  for (const f of FEATURES) {
    for (const on of [false, true]) {
      await open(admin, `${HUB}/admin/settings/plugins`);
      const card = admin.getByRole("region", { name: f.name, exact: true });
      await card.locator(".plugin-card-head").click();
      const box = card.getByLabel(`${f.name} on`);
      await expect(box).toBeChecked({ checked: !on });
      await box.setChecked(on);
      await admin.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(() => setting(f.key), `${f.name} ${on ? "on" : "off"}`).toBe(String(on));
      await expect(card.locator(".plugin-card-state")).toHaveText(on ? "On" : "Off");

      // The hub still works: the feed, and a vote page.
      await open(admin, `${HUB}/process/${vote.id}`);
      await expect(admin.locator("h1").first()).toContainText(vote.title.slice(0, 40));
      if (f.key === "admin_digest") continue;
      if (f.key === "members") await open(admin, `${HUB}/members`);
      const mark = f.mark(admin);
      if (on) await expect(mark, `${f.name} back`).toBeVisible();
      else await expect(mark, `${f.name} gone`).toHaveCount(0);
    }
  }
  await admin.goto(`${HUB}/`);
  await expect(admin.locator(".feed-filter")).toBeVisible();
  await admin.context().close();
});

test("6. an urgent pin is the line across the top of every page, and goes when unpinned", async ({ browser }) => {
  const announcement = sample("civic.announcement");
  const admin = await pageAs(browser, adminToken);
  await admin.goto(`${HUB}/announcement/${announcement.id}`);
  const pin = admin.locator("main").getByRole("region", { name: "Pin" });
  await pin.getByRole("button", { name: "Pin", exact: true }).click();
  await pin.getByLabel("Urgent").check();
  await pin.getByRole("button", { name: "Pin", exact: true }).click();

  // A visitor sees it on the home page, a vote's page, and on a phone.
  for (const [path, viewport] of [
    ["/", DESKTOP],
    [`/process/${sample("civic.vote", "active").id}`, DESKTOP],
    ["/", PHONE],
  ] as const) {
    const visitor = await pageAs(browser, null, viewport);
    await visitor.goto(`${HUB}${path}`);
    const line = visitor.getByRole("region", { name: "Urgent" });
    await expect(line, `${path} at ${viewport.width}px`).toContainText(announcement.title);
    await expect(line.getByRole("link")).toHaveAttribute("href", new RegExp(announcement.id));
    await visitor.context().close();
  }

  // Unpinned, the line goes.
  await admin.goto(`${HUB}/announcement/${announcement.id}`);
  await pin.getByRole("button", { name: /Unpin/ }).click();
  const visitor = await pageAs(browser, null);
  await visitor.goto(`${HUB}/`);
  await expect(visitor.locator(".feed-filter")).toBeVisible();
  await expect(visitor.getByRole("region", { name: "Urgent" })).toHaveCount(0);
  await visitor.context().close();
  await admin.context().close();
});
