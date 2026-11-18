// Pinning any item (Adam, 2026-11-18; src/services/pins.ts): an admin pins a
// vote, not only an announcement, from POST /admin/processes/:id/pin; the
// right column's facts (GET /api/aside) list it with its type's label; unpin
// takes it off; each change is a public `updated` event with `data.pin`; a
// resident may not pin; an archived item can't be pinned.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";

const FLOYD = "floyd.civic.social";
const run = Date.now().toString(36);

let admin = "";
let resident = "";
let vote = "";

async function aside() {
  const res = await call("GET", "/api/aside", FLOYD);
  expect(res.status).toBe(200);
  return res.body as { announcements: Array<{ process_id: string; pinned?: true; type_label?: string }> };
}

/** The pin changes in the hub's log for the vote. */
async function pinEvents(): Promise<string[]> {
  const rows = await localRest(`events?process_id=eq.${vote}&event_type=eq.civic.process.updated&select=data`, {});
  return (rows as Array<{ data: { pin?: { change?: string } } }>).flatMap((e) => (e.data.pin?.change ? [e.data.pin.change] : []));
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
  expect((await call("POST", `/process/${vote}/action`, FLOYD, { type: "process.activate", payload: {} }, admin)).status).toBe(200);
});

afterAll(async () => {
  if (vote) await localRest(`processes?id=eq.${vote}`, { method: "DELETE" });
});

describe("pin any item", () => {
  it("a resident may not pin", async () => {
    const res = await call("POST", `/admin/processes/${vote}/pin`, FLOYD, {}, resident);
    expect(res.status).toBe(403);
  });

  it("an admin pins a vote; the right column lists it with its type", async () => {
    const res = await call("POST", `/admin/processes/${vote}/pin`, FLOYD, {}, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: vote, pinned: true, pinned_until: null });

    const row = (await aside()).announcements.find((a) => a.process_id === vote);
    expect(row).toMatchObject({ pinned: true, type_label: "Vote" });
  });

  it("pinning again changes nothing and records nothing", async () => {
    const before = (await pinEvents()).length;
    expect(before).toBe(1);
    const res = await call("POST", `/admin/processes/${vote}/pin`, FLOYD, {}, admin);
    expect(res.status).toBe(200);
    expect((await pinEvents()).length).toBe(before);
  });

  it("refuses an end date that has passed", async () => {
    const res = await call("POST", `/admin/processes/${vote}/pin`, FLOYD, { pinned_until: "2020-01-01T00:00:00Z" }, admin);
    expect(res.status).toBe(400);
  });

  it("unpin takes it off the card; both changes are in the hub's log", async () => {
    const res = await call("POST", `/admin/processes/${vote}/unpin`, FLOYD, {}, admin);
    expect(res.status).toBe(200);
    expect(res.body.pinned).toBe(false);
    expect((await aside()).announcements.some((a) => a.process_id === vote && a.pinned)).toBe(false);

    expect((await pinEvents()).sort()).toEqual(["pinned", "unpinned"]);
  });

  it("an archived item can't be pinned", async () => {
    expect((await call("POST", `/admin/processes/${vote}/archive`, FLOYD, { reason: "test" }, admin)).status).toBe(200);
    const res = await call("POST", `/admin/processes/${vote}/pin`, FLOYD, {}, admin);
    expect(res.status).toBe(404);
  });
});
