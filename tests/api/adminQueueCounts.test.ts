// The admin queue counts past 1,000 reviews (2026-10-16, the cleanup slice).
//
// GET /admin/queue-counts used to read the pending review rows and count them
// in the server; past PostgREST's 1,000-row cap it failed (CIVIC_ROW_CAP).
// Now the database counts them (count_pending_reviews, 20261018010000). This
// plants 1,050 pending reviews on Floyd after the admin opens the Reviews tab,
// and the tab's number must be exactly 1,050; three more, on a process of a
// type the call leaves out, must not count.
//
// The planted rows are deleted in afterAll. Needs the local stack seeded as in
// CI and a server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";

const FLOYD = "floyd.civic.social";
const run = Date.now();
const MARK = `qc_${run}`;
const PLANTED = 1_050;

let admin = "";
let openedAt = "";
let otherType = "";

function plant(n: number, processId: (i: number) => string, prefix: string) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}_${i}`,
    hub_id: "floyd",
    process_id: processId(i),
    creator_id: `user_${MARK}`,
    creator_name: "Queue count test",
    creator_email: `${MARK}@example.test`,
    status: "pending_review",
  }));
}

beforeAll(async () => {
  admin = await mintSession("floyd", "admin@example.test");
  // Opening the tab: everything before now has been seen.
  expect((await call("POST", "/admin/queues/reviews/seen", FLOYD, {}, admin)).status).toBe(200);
  openedAt = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 20));

  // Reviews need a real process (a foreign key). The 1,050 go on a vote; three
  // more go on a process of another type, which the function is asked to
  // leave out below.
  const procs = (await localRest("processes?hub_id=eq.floyd&select=id,type&order=id")) as Array<{ id: string; type: string }>;
  const onVote = procs.find((p) => p.type === "civic.vote")!;
  const other = procs.find((p) => p.type !== "civic.vote")!;
  expect(onVote && other).toBeTruthy();
  otherType = other.type;

  const rows = plant(PLANTED, () => onVote.id, `rev_${MARK}`);
  for (let i = 0; i < rows.length; i += 500) {
    await localRest("process_reviews", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows.slice(i, i + 500)) });
  }
  await localRest("process_reviews", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(plant(3, () => other.id, `rev_${MARK}_typed`)),
  });
});

afterAll(async () => {
  await localRest(`process_reviews?hub_id=eq.floyd&creator_id=eq.user_${MARK}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
});

describe("GET /admin/queue-counts past 1,000 pending reviews", () => {
  it("counts every review planted since the tab was opened, exactly", async () => {
    const res = await call("GET", "/admin/queue-counts", FLOYD, undefined, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.reviews).toBe(PLANTED + 3);
    expect(res.body.total).toBeGreaterThanOrEqual(PLANTED + 3);
  });

  it("leaves out reviews of a switched-off type's processes", async () => {
    const count = (types: string[]) =>
      localRest("rpc/count_pending_reviews", {
        method: "POST",
        body: JSON.stringify({ p_hub_id: "floyd", p_since: openedAt, p_excluded_types: types }),
      });
    expect(Number(await count([]))).toBe(PLANTED + 3);
    expect(Number(await count([otherType]))).toBe(PLANTED);
  });

  it("is per hub: none of Floyd's reach Athens's count", async () => {
    const res = await localRest("rpc/count_pending_reviews", {
      method: "POST",
      body: JSON.stringify({ p_hub_id: "athens", p_since: openedAt, p_excluded_types: [] }),
    });
    expect(Number(res)).toBe(0);
  });

  it("opening the tab clears it", async () => {
    expect((await call("POST", "/admin/queues/reviews/seen", FLOYD, {}, admin)).status).toBe(200);
    const res = await call("GET", "/admin/queue-counts", FLOYD, undefined, admin);
    expect(res.body.reviews).toBe(0);
  });
});
