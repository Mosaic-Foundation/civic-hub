// The Pinning plugin (features/pinning; Adam, 2026-11-18, a plugin since
// kernel step 4, 2026-11-19): a vote, not only an announcement, is pinned
// from POST /pins/:id; the card (GET /pins) and Admin → Pinned list it with
// its type's word; a pin may be marked urgent (listed first, and the line
// across the top); who may pin is the space's setting (admins by default,
// or every member); each change is a public `updated` event with `data.pin`;
// an archived item can't be pinned; an end date that has passed drops off
// with nothing run; at most ten at once; the plugin's switch off answers 404
// on every route. Announcements no longer has an urgent label of its own.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";

const FLOYD = "floyd.civic.social";
const run = Date.now().toString(36);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

let admin = "";
let resident = "";
let vote = "";
const made: string[] = [];

interface Board {
  items: Array<{ process_id: string; type_label: string; urgent?: true }>;
  urgent: { process_id: string } | null;
  can_pin: boolean;
}

async function board(token?: string): Promise<Board> {
  const res = await call("GET", "/pins", FLOYD, undefined, token);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Board;
}

const pin = (id: string, body: Record<string, unknown> = {}, token = admin) => call("POST", `/pins/${id}`, FLOYD, body, token);
const unpin = (id: string, token = admin) => call("DELETE", `/pins/${id}`, FLOYD, undefined, token);

/** The pin changes in the space's log for the vote. */
async function pinEvents(): Promise<string[]> {
  const rows = await localRest(`events?process_id=eq.${vote}&event_type=eq.civic.process.updated&select=data`, {});
  return (rows as Array<{ data: { pin?: { change?: string } } }>).flatMap((e) => (e.data.pin?.change ? [e.data.pin.change] : []));
}

async function setPlugins(values: Record<string, string>) {
  const res = await call("PUT", "/admin/hub/settings", FLOYD, { section: "plugins", values }, admin);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

async function announce(title: string) {
  const res = await call("POST", "/announcement", FLOYD, { title, body: `Body of ${title}` }, admin);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  made.push(res.body.id as string);
  return res.body.id as string;
}

async function unpinAll() {
  const list = await call("GET", "/admin/pins", FLOYD, undefined, admin);
  for (const r of list.body.items as Array<{ id: string }>) await unpin(r.id);
}

beforeAll(async () => {
  admin = await mintSession("floyd", "admin@example.test");
  resident = await mintSession("floyd", `pin-resident-${run}@example.test`);
  const created = await call("POST", "/process", FLOYD, {
    definition: { type: "civic.vote", version: "0.1" },
    title: `Pin any item ${run}`,
    description: "A vote to pin.",
    state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
  }, admin);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  vote = created.body.id as string;
  made.push(vote);
  expect((await call("POST", `/process/${vote}/action`, FLOYD, { type: "process.activate", payload: {} }, admin)).status).toBe(200);
  await unpinAll();
});

afterAll(async () => {
  await setPlugins({ "plugin.pinning.enabled": "true", "plugin.pinning.who": "admins" });
  for (const id of made) await localRest(`processes?id=eq.${id}`, { method: "DELETE" });
});

describe("the Pinning plugin", () => {
  it("by default a member may not pin, and the card says so", async () => {
    expect((await pin(vote, {}, resident)).status).toBe(403);
    expect((await board(resident)).can_pin).toBe(false);
    expect((await board(admin)).can_pin).toBe(true);
  });

  it("an admin pins a vote; the card lists it with its type", async () => {
    const res = await pin(vote);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: vote, pinned: true, pinned_until: null, urgent: false });
    expect((await call("GET", `/pins/${vote}`, FLOYD, undefined, admin)).body).toMatchObject({ pinned: true });
    expect((await board()).items.find((a) => a.process_id === vote)).toMatchObject({ type_label: "Vote" });
  });

  it("Admin → Pinned lists it, with the count against the cap; a member can't read it", async () => {
    const res = await call("GET", "/admin/pins", FLOYD, undefined, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = (res.body.items as Array<Record<string, unknown>>).find((r) => r.id === vote);
    expect(row).toMatchObject({ type: "civic.vote", type_label: "Vote", pinned_until: null, urgent: false, url: `/process/${vote}` });
    expect(res.body.pinned_max).toBe(10);
    expect((await call("GET", "/admin/pins", FLOYD, undefined, resident)).status).toBe(403);
  });

  it("marked urgent, it comes first and is the line across the top; unmarked, it is not", async () => {
    const other = await announce(`Pinned first ${run}`);
    expect((await pin(other)).status).toBe(200);
    expect((await pin(vote, { urgent: true })).body).toMatchObject({ pinned: true, urgent: true });
    let b = await board();
    expect(b.items[0]).toMatchObject({ process_id: vote, urgent: true });
    expect(b.urgent?.process_id).toBe(vote);
    // Changing the end date keeps the flag.
    expect((await pin(vote, { pinned_until: inDays(3) })).body).toMatchObject({ urgent: true });
    expect((await pin(vote, { pinned_until: null, urgent: false })).body).toMatchObject({ urgent: false });
    b = await board();
    expect(b.urgent).toBeNull();
    expect((await unpin(other)).status).toBe(200);
  });

  it("Announcements has no urgent label of its own any more", async () => {
    const id = await announce(`Not urgent ${run}`);
    const page = await call("GET", `/announcement/${id}`, FLOYD);
    expect(page.body.urgent).toBeUndefined();
    expect((await board()).items.some((a) => a.process_id === id)).toBe(false);
  });

  it("pinning again changes nothing and records nothing", async () => {
    const before = (await pinEvents()).length;
    expect((await pin(vote, { pinned_until: null, urgent: false })).status).toBe(200);
    expect((await pinEvents()).length).toBe(before);
  });

  it("refuses an end date that has passed", async () => {
    expect((await pin(vote, { pinned_until: "2020-01-01T00:00:00Z" })).status).toBe(400);
  });

  it("with every member allowed, a member pins and unpins", async () => {
    await setPlugins({ "plugin.pinning.who": "members" });
    try {
      expect((await board(resident)).can_pin).toBe(true);
      const id = await announce(`Member pin ${run}`);
      expect((await pin(id, {}, resident)).status).toBe(200);
      expect((await unpin(id, resident)).status).toBe(200);
      expect((await board(undefined)).can_pin).toBe(false);
    } finally {
      await setPlugins({ "plugin.pinning.who": "admins" });
    }
  });

  it("with the plugin off: every route answers 404; back on, the pin it kept shows again", async () => {
    await setPlugins({ "plugin.pinning.enabled": "false" });
    try {
      expect((await call("GET", "/pins", FLOYD)).status).toBe(404);
      expect((await call("GET", "/admin/pins", FLOYD, undefined, admin)).status).toBe(404);
      expect((await unpin(vote)).status).toBe(404);
    } finally {
      await setPlugins({ "plugin.pinning.enabled": "true" });
    }
    expect((await board()).items.some((a) => a.process_id === vote)).toBe(true);
  });

  it("unpin takes it off the card; the changes are in the space's log", async () => {
    const res = await unpin(vote);
    expect(res.status).toBe(200);
    expect(res.body.pinned).toBe(false);
    expect((await board()).items.some((a) => a.process_id === vote)).toBe(false);
    expect([...new Set(await pinEvents())].sort()).toEqual(["pinned", "unpinned"]);
  });

  it("an end date that has passed drops it off with nothing run", async () => {
    const id = await announce(`Old pin ${run}`);
    expect((await pin(id)).status).toBe(200);
    await localRest(`process_pins?hub_id=eq.floyd&process_id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ pinned_until: inDays(-1) }),
    });
    expect((await board()).items.some((a) => a.process_id === id)).toBe(false);
    await unpin(id);
  });

  it("holds at ten pinned at once; a pin readers can't see holds no place", async () => {
    await unpinAll();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = await announce(`Pin ${i} ${run}`);
      ids.push(id);
      expect((await pin(id)).status).toBe(200);
    }
    const extra = await announce(`Pin 11 ${run}`);
    const over = await pin(extra);
    expect(over.status).toBe(400);
    expect(JSON.stringify(over.body)).toMatch(/Unpin one first/);
    expect((await call("POST", `/admin/processes/${ids[0]}/archive`, FLOYD, { reason: "test" }, admin)).status).toBe(200);
    expect((await call("GET", "/admin/pins", FLOYD, undefined, admin)).body.pinned_count).toBe(9);
    expect((await pin(extra)).status).toBe(200);
    await unpinAll();
    await unpin(ids[0]);
  });

  it("an archived item can't be pinned", async () => {
    expect((await call("POST", `/admin/processes/${vote}/archive`, FLOYD, { reason: "test" }, admin)).status).toBe(200);
    expect((await pin(vote)).status).toBe(404);
  });
});
