// GET /api/aside, GET /api/feed/closing and the three-column settings (layout
// session, 2026-11-07; ADR-019; Events 4, 2026-11-09). The right column's
// facts are announcements and About: Coming up reads the calendar, and closing
// dates are the feed's "closing soon" cards. GET /api/feed/closing is an open
// process closing within 48 hours, earliest first; not one further out, under
// review, already past, or another hub's. No account, name or ballot in either. The settings: nav.layout takes
// "three_columns", and nav.aside_cards is a list of { id, shown }, refused
// when it is anything else.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession, storedSetting } from "../fixtures/adminSession.js";

const FLOYD = "floyd.civic.social";
const run = Date.now().toString(36);
const soon = new Date(Date.now() + 2 * 60_000).toISOString();
const later = new Date(Date.now() + 72 * 3_600_000).toISOString();
const ids = {
  soon: `proc_as_soon_${run}`,
  later: `proc_as_later_${run}`,
  past: `proc_as_past_${run}`,
  pending: `proc_as_pending_${run}`,
  athens: `proc_as_athens_${run}`,
};

let admin = "";
let before: { layout?: string; cards?: string } = {};

async function insert(id: string, hub: string, status: string, closes: string) {
  await localRest("processes", {
    method: "POST",
    body: JSON.stringify({
      id, hub_id: hub, type: "civic.vote", title: `Aside ${id}`, description: "d", status,
      state: { options: ["Yes", "No"], votes: {}, voting_closes_at: closes },
    }),
  });
}

beforeAll(async () => {
  admin = await mintSession("floyd", "admin@example.test");
  before = { layout: await storedSetting("floyd", "nav.layout"), cards: await storedSetting("floyd", "nav.aside_cards") };
  await insert(ids.soon, "floyd", "active", soon);
  await insert(ids.later, "floyd", "active", later);
  await insert(ids.past, "floyd", "active", new Date(Date.now() - 60_000).toISOString());
  await insert(ids.pending, "floyd", "pending_review", soon);
  await insert(ids.athens, "athens", "active", soon);
});

afterAll(async () => {
  for (const id of Object.values(ids)) await localRest(`processes?id=eq.${id}`, { method: "DELETE" });
  await call("PUT", "/admin/hub/settings", FLOYD, {
    section: "theme",
    values: { "nav.layout": before.layout ?? "", "nav.aside_cards": before.cards ?? "" },
  }, admin);
});

describe("GET /api/feed/closing", () => {
  it("lists what closes within 48 hours, earliest first, and nothing else", async () => {
    const res = await call("GET", "/api/feed/closing", FLOYD);
    expect(res.status).toBe(200);
    const closing = res.body.closing as Array<{ process_id: string; closes_at: string; since: string }>;
    const listed = closing.map((d) => d.process_id);
    expect(listed).toContain(ids.soon);
    for (const id of [ids.later, ids.past, ids.pending, ids.athens]) expect(listed).not.toContain(id);
    const times = closing.map((d) => d.closes_at);
    expect([...times].sort()).toEqual(times);
    const mine = closing.find((d) => d.process_id === ids.soon)!;
    // Opened inside the window, so it entered it when it opened (just now), not 48 hours before its close.
    expect(Date.parse(mine.since)).toBeGreaterThan(Date.parse(soon) - 48 * 3_600_000);
    expect(Date.parse(mine.since)).toBeLessThanOrEqual(Date.now());
    expect(mine).toEqual({
      process_id: ids.soon, type: "civic.vote", title: `Aside ${ids.soon}`, closes_at: soon, since: mine.since, url: `/process/${ids.soon}`,
    });
  });
});

describe("GET /api/aside", () => {
  it("has no closing dates: Coming up is the calendar's (Events 4)", async () => {
    const res = await call("GET", "/api/aside", FLOYD);
    expect(res.status).toBe(200);
    expect(res.body.deadlines).toBeUndefined();
  });

  it("serves the same to a signed-out reader, and no account or name", async () => {
    const res = await call("GET", "/api/aside", FLOYD);
    expect(Object.keys(res.body).sort()).toEqual(["about", "announcements"]);
    for (const a of res.body.announcements as Array<Record<string, unknown>>) {
      expect(Object.keys(a).filter((k) => k !== "sample").sort()).toEqual(["process_id", "published_at", "title", "url"]);
    }
    const count = (res.body.about as { member_count: number | null }).member_count;
    // The Members plugin's own rule: the count when GET /members/summary shows it, else null.
    const summary = await call("GET", "/members/summary", FLOYD);
    expect(count).toBe(summary.status === 200 && summary.body.shown ? summary.body.count : null);
  });
});

describe("the three-column settings", () => {
  it("takes Three columns and a list of cards, and refuses anything else", async () => {
    const ok = await call("PUT", "/admin/hub/settings", FLOYD, {
      section: "theme",
      values: { "nav.layout": "three_columns", "nav.aside_cards": [{ id: "about", shown: true }, { id: "coming_up", shown: false }] },
    }, admin);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await storedSetting("floyd", "nav.layout")).toBe("three_columns");
    expect(await storedSetting("floyd", "nav.aside_cards")).toBe('[{"id":"about","shown":true},{"id":"coming_up","shown":false}]');

    for (const bad of [
      "not json",
      [{ id: "about" }],
      [{ id: "About!", shown: true }],
      [{ id: "about", shown: true }, { id: "about", shown: false }],
    ]) {
      const res = await call("PUT", "/admin/hub/settings", FLOYD, { section: "theme", values: { "nav.aside_cards": bad } }, admin);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    const layout = await call("PUT", "/admin/hub/settings", FLOYD, { section: "theme", values: { "nav.layout": "four_columns" } }, admin);
    expect(layout.status).toBe(400);
  });

  it("serves both to every reader, as the page draws them", async () => {
    const res = await call("GET", "/hub-config", FLOYD);
    const settings = res.body.settings as Record<string, string>;
    expect(settings["nav.layout"]).toBe("three_columns");
    expect(settings["nav.aside_cards"]).toBeDefined();
  });

  it("is an admin's to change", async () => {
    const res = await call("PUT", "/admin/hub/settings", FLOYD, { section: "theme", values: { "nav.layout": "sidebar" } });
    expect([401, 403]).toContain(res.status);
  });
});
