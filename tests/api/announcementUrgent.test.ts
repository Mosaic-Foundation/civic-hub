// Urgent announcements on the hub's Pinned card (Adam, 2026-11-15; pinning
// phase 2, 2026-11-18). Anyone who may post marks one urgent with an end date
// (packages/civic.announcement/board.ts); Announcements offers it to the card
// (PluginServer.pinnedCard), so GET /api/aside lists it first and as the line
// across the top. Pinning is the hub's (process_pins): an admin pins an
// announcement like any item, from POST /admin/processes/:id/pin; the plugin's
// own pin routes and form fields are gone; an end date that has passed drops
// off with nothing run; at most ten at once.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";

const FLOYD = "floyd.civic.social";
const run = Date.now().toString(36);
const official = `ann-official-${run}@example.test`;
const day = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * day).toISOString();

let admin = "";
let author = "";
const made: string[] = [];

async function post(title: string, extra: Record<string, unknown> = {}, token = admin) {
  const res = await call("POST", "/announcement", FLOYD, { title, body: `Body of ${title}`, ...extra }, token);
  if (res.status === 201) made.push(res.body.id as string);
  return res;
}

async function aside() {
  const res = await call("GET", "/api/aside", FLOYD);
  expect(res.status).toBe(200);
  return res.body as {
    card_title: string;
    announcements: Array<{ process_id: string; pinned?: true; urgent?: true; type_label?: string }>;
    urgent: { process_id: string } | null;
  };
}

/** Unpin whatever an earlier run left pinned, so the cap starts from zero. */
async function unpinAll() {
  const list = await call("GET", "/admin/pins", FLOYD, undefined, admin);
  for (const row of list.body.items as Array<{ id: string; pinned: boolean }>) {
    if (row.pinned) await call("POST", `/admin/processes/${row.id}/unpin`, FLOYD, {}, admin);
  }
}

const pin = (id: string, body: Record<string, unknown> = {}) => call("POST", `/admin/processes/${id}/pin`, FLOYD, body, admin);

beforeAll(async () => {
  admin = await mintSession("floyd", "admin@example.test");
  // An official: may post and mark urgent, not pin.
  author = await mintSession("floyd", official);
  await localRest(`users?hub_id=eq.floyd&email=eq.${encodeURIComponent(official)}`, {
    method: "PATCH",
    body: JSON.stringify({ official_type: "other", official_title: "Clerk" }),
  });
  author = await mintSession("floyd", official);
  await unpinAll();
});

afterAll(async () => {
  for (const id of made) await localRest(`processes?id=eq.${id}`, { method: "DELETE" });
});

describe("urgent", () => {
  it("an official marks an announcement urgent; it shows on the page, the card and the top line", async () => {
    const res = await post(`Boil water ${run}`, { urgent: true, urgent_until: inDays(3) }, author);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.urgent).toBe(true);
    const id = res.body.id as string;

    const page = await call("GET", `/announcement/${id}`, FLOYD);
    expect(page.body.urgent).toBe(true);
    expect(Date.parse(page.body.urgent_until)).toBeGreaterThan(Date.now());

    const facts = await aside();
    expect(facts.announcements[0]).toMatchObject({ process_id: id, urgent: true });
    expect(facts.urgent?.process_id).toBe(id);
  });

  it("needs an end date, at most 30 days away", async () => {
    expect((await post(`No date ${run}`, { urgent: true }, author)).status).toBe(400);
    expect((await post(`Too far ${run}`, { urgent: true, urgent_until: inDays(45) }, author)).status).toBe(400);
    expect((await post(`Past ${run}`, { urgent: true, urgent_until: inDays(-1) }, author)).status).toBe(400);
  });

  it("the author clears it on the edit form, with an `updated` event", async () => {
    const id = (await post(`Road closed ${run}`, { urgent: true, urgent_until: inDays(2) }, author)).body.id as string;
    const res = await call("PATCH", `/announcement/${id}`, FLOYD, { urgent: false }, author);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.urgent).toBe(false);
    const events = await localRest(`events?process_id=eq.${id}&event_type=eq.civic.process.updated&select=data`, {});
    const changes = (events as Array<{ data: { announcement?: { board_change?: string } } }>).map((e) => e.data.announcement?.board_change);
    expect(changes).toContain("not_urgent");
  });
});

describe("pinned", () => {
  it("the plugin pins nothing itself: its routes are gone and a `pinned` field on the form is ignored", async () => {
    const res = await post(`Form pin ${run}`, { pinned: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.id as string;
    expect(res.body.pinned).toBeUndefined();
    expect((await aside()).announcements.some((a) => a.process_id === id && a.pinned)).toBe(false);
    expect((await call("GET", "/admin/announcements", FLOYD, undefined, admin)).status).toBe(404);
    expect((await call("POST", `/admin/announcements/${id}/pin`, FLOYD, {}, admin)).status).toBe(404);
  });

  it("an admin pins an announcement as any item; Admin → Pinned and the card follow", async () => {
    const id = (await post(`Fire ban ${run}`)).body.id as string;
    const res = await pin(id, { pinned_until: inDays(10) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id, pinned: true });

    const list = await call("GET", "/admin/pins", FLOYD, undefined, admin);
    expect((list.body.items as Array<{ id: string }>).map((r) => r.id)).toContain(id);

    let facts = await aside();
    expect(facts.card_title).toBe("Pinned");
    expect(facts.announcements.find((a) => a.process_id === id)).toMatchObject({ pinned: true, type_label: "Announcement" });
    // Urgent ones come before pinned ones.
    const firstPinnedOnly = facts.announcements.findIndex((a) => !a.urgent);
    expect(facts.announcements.slice(firstPinnedOnly).every((a) => !a.urgent)).toBe(true);

    const unpin = await call("POST", `/admin/processes/${id}/unpin`, FLOYD, {}, admin);
    expect(unpin.status).toBe(200);
    expect(unpin.body.pinned).toBe(false);
    facts = await aside();
    expect(facts.announcements.some((a) => a.process_id === id && a.pinned)).toBe(false);
  });

  it("an urgent announcement that is also pinned shows once, at the top", async () => {
    const id = (await post(`Urgent and pinned ${run}`, { urgent: true, urgent_until: inDays(2) }, author)).body.id as string;
    expect((await pin(id)).status).toBe(200);
    const rows = (await aside()).announcements.filter((a) => a.process_id === id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ urgent: true, pinned: true });
    await call("POST", `/admin/processes/${id}/unpin`, FLOYD, {}, admin);
  });

  it("an end date that has passed drops it off with nothing run", async () => {
    const id = (await post(`Old pin ${run}`)).body.id as string;
    expect((await pin(id)).status).toBe(200);
    // As if its end date had passed: written straight to the hub's pins.
    await localRest(`process_pins?hub_id=eq.floyd&process_id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ pinned_until: inDays(-1) }),
    });
    expect((await aside()).announcements.some((a) => a.process_id === id)).toBe(false);
    const list = await call("GET", "/admin/pins", FLOYD, undefined, admin);
    expect((list.body.items as Array<{ id: string }>).some((r) => r.id === id)).toBe(false);
    await call("POST", `/admin/processes/${id}/unpin`, FLOYD, {}, admin);
  });

  it("holds at ten pinned at once", async () => {
    await unpinAll();
    for (let i = 0; i < 10; i++) {
      const id = (await post(`Pin ${i} ${run}`)).body.id as string;
      const res = await pin(id);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    const id = (await post(`Pin 11 ${run}`)).body.id as string;
    const over = await pin(id);
    expect(over.status).toBe(400);
    expect(JSON.stringify(over.body)).toMatch(/Unpin one first/);
    const facts = await aside();
    expect(facts.announcements.filter((a) => a.pinned).length).toBe(10);
    await unpinAll();
  });
});
