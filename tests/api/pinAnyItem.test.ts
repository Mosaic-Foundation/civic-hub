// Pinning any item (Adam, 2026-11-18; src/services/pins.ts): an admin pins a
// vote, not only an announcement, from POST /admin/processes/:id/pin; the
// right column's facts (GET /api/aside) and Admin → Pinned (GET /admin/pins)
// list it with its type's label; unpin takes it off; each change is a public
// `updated` event with `data.pin`; a resident may not pin; an archived item
// can't be pinned; Approve can pin what it posts; the hub's Pinning switch off
// answers 404 on every pin route and shows no pinned row on the card.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { pendingProposalReview } from "../fixtures/codeOfConduct.js";

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

const made: string[] = [];

async function setPinning(on: "true" | "false") {
  const res = await call("PUT", "/admin/hub/settings", FLOYD, { section: "plugins", values: { "plugin.pinning.enabled": on } }, admin);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

afterAll(async () => {
  await setPinning("true");
  if (vote) await localRest(`processes?id=eq.${vote}`, { method: "DELETE" });
  // A reviewed process keeps its review thread (append-only): archived, not deleted.
  for (const id of made) await localRest(`processes?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "archived" }) });
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

  it("Admin → Pinned lists it, with the count against the cap; a resident can't read it", async () => {
    const res = await call("GET", "/admin/pins", FLOYD, undefined, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = (res.body.items as Array<Record<string, unknown>>).find((r) => r.id === vote);
    expect(row).toMatchObject({ type: "civic.vote", type_label: "Vote", pinned: true, pinned_until: null, urgent: false, url: `/process/${vote}` });
    expect(res.body.pinned_max).toBe(10);
    expect(res.body.pinned_count).toBeGreaterThanOrEqual(1);
    expect((await call("GET", "/admin/pins", FLOYD, undefined, resident)).status).toBe(403);
  });

  it("with the hub's Pinning switch off: the routes answer 404 and the card shows no pin", async () => {
    await setPinning("false");
    try {
      expect((await call("GET", "/admin/pins", FLOYD, undefined, admin)).status).toBe(404);
      expect((await call("POST", `/admin/processes/${vote}/unpin`, FLOYD, {}, admin)).status).toBe(404);
      expect((await aside()).announcements.some((a) => a.process_id === vote && a.pinned)).toBe(false);
    } finally {
      await setPinning("true");
    }
    // Back on, the pin it kept shows again.
    expect((await aside()).announcements.some((a) => a.process_id === vote && a.pinned)).toBe(true);
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

  it("Approve can pin what it posts, with an end date", async () => {
    const pending = await pendingProposalReview(FLOYD, resident, `Pin on approve ${run}`);
    made.push(pending.process_id);
    const until = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const res = await call("POST", `/admin/reviews/${pending.review_id}/approve`, FLOYD, { pin: { pinned_until: until } }, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.pin).toMatchObject({ pinned: true });
    expect(Date.parse(res.body.pin.pinned_until)).toBe(Date.parse(until));
    const row = (await call("GET", "/admin/pins", FLOYD, undefined, admin)).body.items.find((r: { id: string }) => r.id === pending.process_id);
    expect(row).toMatchObject({ pinned: true, type: "civic.proposal" });
    expect((await call("POST", `/admin/processes/${pending.process_id}/unpin`, FLOYD, {}, admin)).status).toBe(200);
  });

  it("an archived item can't be pinned", async () => {
    expect((await call("POST", `/admin/processes/${vote}/archive`, FLOYD, { reason: "test" }, admin)).status).toBe(200);
    const res = await call("POST", `/admin/processes/${vote}/pin`, FLOYD, {}, admin);
    expect(res.status).toBe(404);
  });
});
