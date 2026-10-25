// GET /api/feed/meta and hub-config's content.sample_items (frontend pass,
// 2026-10-24). The hub's feed reads its cards off /events and asks this for
// what the stream does not carry. A process the hub shows answers its type,
// its sample flag and its card metadata; one it does not (gone, pending
// review, archived, a switched-off plugin, another hub's) answers
// { hidden: true } and nothing else, to anyone.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";

const FLOYD = "floyd.civic.social";
const ATHENS = "athens.localhost";
const run = Date.now().toString(36);
const ids = {
  shown: "", // a real vote, made through the API below: its card metadata is the handler's
  pending: `proc_fm_pending_${run}`,
  archived: `proc_fm_archived_${run}`,
  sample: `proc_fm_sample_${run}`,
  athens: `proc_fm_athens_${run}`,
};

let admin = "";

async function insert(id: string, hub: string, status: string, extra: Record<string, unknown> = {}) {
  await localRest("processes", {
    method: "POST",
    body: JSON.stringify({
      id, hub_id: hub, type: "civic.vote", title: `Feed meta ${id}`, description: "d", status,
      state: { options: ["Yes", "No"], votes: {} }, ...extra,
    }),
  });
}

beforeAll(async () => {
  admin = await mintSession("floyd", "admin@example.test");
  const created = await call("POST", "/process", FLOYD, {
    definition: { type: "civic.vote", version: "0.1" },
    title: `Feed meta shown ${run}`,
    description: "A vote for the feed meta test.",
    state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
  }, admin);
  expect(created.status).toBe(201);
  ids.shown = created.body.id as string;
  expect((await call("POST", `/process/${ids.shown}/action`, FLOYD, { type: "process.activate", payload: {} }, admin)).status).toBe(200);
  await insert(ids.pending, "floyd", "pending_review");
  await insert(ids.archived, "floyd", "archived");
  await insert(ids.sample, "floyd", "active", { is_sample: true });
  await insert(ids.athens, "athens", "active");
});

afterAll(async () => {
  // The vote stays, with its events (the log is append-only), as other tests' do.
  for (const id of [ids.pending, ids.archived, ids.sample, ids.athens]) await localRest(`processes?id=eq.${id}`, { method: "DELETE" });
});

describe("GET /feed/meta", () => {
  it("says what the hub shows, and nothing of what it does not, to every reader", async () => {
    const q = `/feed/meta?process=${Object.values(ids).join(",")},proc_fm_none_${run}`;
    for (const token of [undefined, admin]) {
      const res = await call("GET", q, FLOYD, undefined, token);
      expect(res.status).toBe(200);
      const p = (res.body as { processes: Record<string, Record<string, unknown>> }).processes;
      expect(p[ids.shown]!.type).toBe("civic.vote");
      expect(p[ids.shown]!.sample).toBeUndefined();
      expect(p[ids.shown]!.meta).toMatchObject({ title: `Feed meta shown ${run}` });
      expect(p[ids.sample]).toMatchObject({ type: "civic.vote", sample: true });
      for (const hidden of [ids.pending, ids.archived, ids.athens, `proc_fm_none_${run}`]) {
        expect(p[hidden], hidden).toEqual({ hidden: true });
      }
    }
  });

  it("refuses a malformed id and more than 100", async () => {
    expect((await call("GET", "/feed/meta?process=proc_1,../x", FLOYD)).status).toBe(400);
    const many = Array.from({ length: 101 }, (_, i) => `proc_${i}`).join(",");
    expect((await call("GET", `/feed/meta?process=${many}`, FLOYD)).status).toBe(400);
    const none = await call("GET", "/feed/meta", FLOYD);
    expect(none.status).toBe(200);
    expect(none.body).toEqual({ processes: {} });
  });
});

describe("hub-config content.sample_items", () => {
  it("is true while any sample process is left, seeded or a visitor's", async () => {
    const res = await call("GET", "/hub-config", FLOYD);
    expect((res.body as { content: { sample_items: boolean } }).content.sample_items).toBe(true);
    await localRest(`processes?id=eq.${ids.sample}`, { method: "PATCH", body: JSON.stringify({ is_sample: false }) });
    const after = await call("GET", "/hub-config", FLOYD);
    const content = (after.body as { content: { samples: boolean; sample_items: boolean } }).content;
    expect(content.sample_items).toBe(false);
    expect(content.samples).toBe(false);
    // Athens, the demo fixture hub, keeps its feed on /api/feed.
    const athens = await call("GET", "/hub-config", ATHENS);
    expect((athens.body as { content: { sample_items: boolean } }).content.sample_items).toBeTypeOf("boolean");
  });
});
