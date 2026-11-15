// Pinned and urgent announcements (Adam, 2026-11-15; src/shared/
// announcementBoard.ts). An admin pins and unpins (Admin → Announcements, the
// form, the page); anyone who may post marks one urgent with an end date; the
// right column's facts (GET /api/aside) show what is pinned or urgent, urgent
// first, and the newest urgent one for the line across the top; an end date
// that has passed drops off with nothing run; each change is an `updated`
// event in the hub's log.
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
    announcements: Array<{ process_id: string; pinned?: true; urgent?: true }>;
    urgent: { process_id: string } | null;
  };
}

/** Unpin whatever an earlier run left pinned, so the cap starts from zero. */
async function unpinAll() {
  const list = await call("GET", "/admin/announcements", FLOYD, undefined, admin);
  for (const row of list.body.pinned as Array<{ id: string; pinned: boolean }>) {
    if (row.pinned) await call("POST", `/admin/announcements/${row.id}/unpin`, FLOYD, {}, admin);
  }
}

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
  it("only an admin may pin, on the form or the admin routes", async () => {
    expect((await post(`Official pin ${run}`, { pinned: true }, author)).status).toBe(403);
    const id = (await post(`Plain ${run}`, {}, author)).body.id as string;
    expect((await call("PATCH", `/announcement/${id}`, FLOYD, { pinned: true }, author)).status).toBe(403);
    expect((await call("POST", `/admin/announcements/${id}/pin`, FLOYD, {}, author)).status).toBe(403);
  });

  it("an admin pins on the form and unpins from Admin → Announcements; the card follows", async () => {
    const res = await post(`Fire ban ${run}`, { pinned: true, pinned_until: inDays(10) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.id as string;
    expect(res.body.pinned).toBe(true);

    const list = await call("GET", "/admin/announcements", FLOYD, undefined, admin);
    expect(list.status).toBe(200);
    expect((list.body.pinned as Array<{ id: string }>).map((r) => r.id)).toContain(id);
    expect(list.body.pinned_max).toBe(10);

    let facts = await aside();
    const row = facts.announcements.find((a) => a.process_id === id);
    expect(row).toMatchObject({ pinned: true });
    // Urgent ones come before pinned ones.
    const firstPinnedOnly = facts.announcements.findIndex((a) => !a.urgent);
    expect(facts.announcements.slice(firstPinnedOnly).every((a) => !a.urgent)).toBe(true);

    const unpin = await call("POST", `/admin/announcements/${id}/unpin`, FLOYD, {}, admin);
    expect(unpin.status).toBe(200);
    expect(unpin.body.pinned).toBe(false);
    facts = await aside();
    expect(facts.announcements.some((a) => a.process_id === id && a.pinned)).toBe(false);
  });

  it("an end date that has passed drops it off with nothing run", async () => {
    const id = (await post(`Old pin ${run}`)).body.id as string;
    expect((await call("POST", `/admin/announcements/${id}/pin`, FLOYD, {}, admin)).status).toBe(200);
    // As if its end date had passed: written straight to the state.
    const [row] = (await localRest(`processes?id=eq.${id}&select=state`, {})) as Array<{ state: Record<string, unknown> }>;
    await localRest(`processes?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ state: { ...row.state, pinned_until: inDays(-1) } }),
    });
    expect((await aside()).announcements.some((a) => a.process_id === id)).toBe(false);
    expect((await call("GET", `/announcement/${id}`, FLOYD)).body.pinned).toBe(false);
  });

  it("holds at ten pinned at once", async () => {
    await unpinAll();
    for (let i = 0; i < 10; i++) {
      const res = await post(`Pin ${i} ${run}`, { pinned: true });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const over = await post(`Pin 11 ${run}`, { pinned: true });
    expect(over.status).toBe(400);
    expect(JSON.stringify(over.body)).toMatch(/Unpin one first/);
    const facts = await aside();
    expect(facts.announcements.filter((a) => a.pinned).length).toBe(10);
    await unpinAll();
  });

  it("writes `pinned` and `unpinned` to the hub's event log", async () => {
    const id = (await post(`Logged ${run}`)).body.id as string;
    await call("POST", `/admin/announcements/${id}/pin`, FLOYD, { pinned_until: inDays(5) }, admin);
    await call("POST", `/admin/announcements/${id}/unpin`, FLOYD, {}, admin);
    const events = await localRest(`events?process_id=eq.${id}&event_type=eq.civic.process.updated&select=data&order=created_at.asc`, {});
    const changes = (events as Array<{ data: { announcement?: { board_change?: string } } }>).map((e) => e.data.announcement?.board_change);
    expect(changes).toEqual(["pinned", "unpinned"]);
  });
});
