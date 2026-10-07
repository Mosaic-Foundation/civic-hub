// No read of a hub's data silently stops at 1,000 rows (2026-10-07).
//
// A hub of its own (`bulk-<run>`), seeded with more events than PostgREST
// returns in one answer: 1,100 open votes, 400 ballots, three moderation
// actions and a broken publication, ~1,500 events in all, the oldest written
// first. Before this slice the feed, the moderation log and feed health each
// read "every event" in one request, got the newest 1,000, and lost the rest
// without a word. Here:
//   - the feed's pages, followed to the end, hold every card, the oldest
//     included, once each, newest first; a page load is one small page;
//   - the moderation log holds the oldest action;
//   - feed health finds the broken publication, the oldest event of all;
//   - a new unbounded read of the same table is refused (CIVIC_ROW_CAP),
//     and readAll() reads it whole.
//
// Needs the local stack and a server (CIVIC_API_BASE); both modes.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { call } from "../fixtures/hostCall.js";
import { localRest, localStack, mintSession } from "../fixtures/adminSession.js";

const LOCAL_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const LOCAL_PUBLISHABLE_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

const tag = randomBytes(3).toString("hex");
const HUB = `bulk-${tag}`;
const HOST = `${HUB}.localhost`;
const ADMIN = `admin+${HUB}@example.test`;
const VOTES = 1100;
const BALLOTS = 400;
const T0 = Date.parse("2025-01-01T00:00:00.000Z");

const brokenId = `proc_${tag}_broken`;
const modTargetId = `proc_${tag}_modtarget`;
const voteId = (i: number) => `proc_${tag}_v${String(i).padStart(4, "0")}`;
const startedId = (i: number) => `evt_${tag}_s${String(i).padStart(4, "0")}`;

let minute = 0;
/** The next timestamp, a minute after the last: rows are written oldest first. */
const at = () => new Date(T0 + minute++ * 60_000).toISOString();

function event(id: string, event_type: string, process_id: string, data: Record<string, unknown>, restricted = false) {
  return {
    id,
    hub_id: HUB,
    version: "0.1",
    event_type,
    process_id,
    actor: "user:civic-admin",
    jurisdiction: "us-test-bulk",
    action_url: `http://${HOST}/process/${process_id}`,
    source: { hub_id: `civic-hub-${HUB}`, hub_url: `http://${HOST}` },
    data,
    meta: { visibility: restricted ? "restricted" : "public" },
    created_at: at(),
  };
}

function procRow(id: string, type: string, title: string, state: Record<string, unknown> = {}) {
  return {
    id,
    hub_id: HUB,
    type,
    title,
    description: title,
    jurisdiction: "us-test-bulk",
    status: "active",
    created_by: "user:civic-admin",
    state: { type, ...state },
  };
}

async function post(table: string, rows: unknown[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    await localRest(table, { method: "POST", body: JSON.stringify(rows.slice(i, i + 500)) });
  }
}

/** The server's own code, in this process, on the bulk hub, in the server's mode. */
async function onHub<T>(fn: () => Promise<T>): Promise<T> {
  const { url, key } = localStack();
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  if (process.env.CIVIC_EXPECT_HUB_DB_MODE?.trim() === "hub_token") {
    process.env.CIVIC_HUB_MINTED_TOKEN = "true";
    process.env.CIVIC_HUB_SIGNING_KEY ??= LOCAL_JWT_SECRET;
    process.env.SUPABASE_PUBLISHABLE_KEY ??= LOCAL_PUBLISHABLE_KEY;
  } else {
    process.env.CIVIC_HUB_MINTED_TOKEN = "false";
  }
  const { getHubBySlug } = await import("../../src/db/hubs.js");
  const { fetchHubSettings } = await import("../../src/db/hubSettingsStore.js");
  const { runWithHub } = await import("../../src/config/hubContext.js");
  const hub = (await getHubBySlug(HUB))!;
  const settings = await fetchHubSettings(HUB);
  return runWithHub(hub, settings, fn);
}

beforeAll(async () => {
  await localRest("hubs", {
    method: "POST",
    body: JSON.stringify({
      id: HUB,
      protocol_hub_id: `civic-hub-${HUB}`,
      hostname: HOST,
      name: `Bulk Test ${tag}`,
      jurisdiction_code: "us-test-bulk",
      jurisdiction_name: "Bulk Test",
      space_did: `did:web:${HOST}`,
      mode: "demo",
    }),
  });
  await localRest("hub_settings", {
    method: "POST",
    body: JSON.stringify({ hub_id: HUB, key: "people.admin_emails", value: JSON.stringify([ADMIN]) }),
  });

  await post("processes", [
    // Announced as published, but its approval went back to pending: the
    // broken link feed health exists to find.
    procRow(brokenId, "civic.meeting_summary", `Broken summary ${tag}`, { approval_status: "pending" }),
    procRow(modTargetId, "civic.announcement", `Moderated ${tag}`),
    ...Array.from({ length: VOTES }, (_, i) =>
      procRow(voteId(i), "civic.vote", i === 0 ? `Oldest vote ${tag}` : `Vote ${i} ${tag}`, {
        options: ["Yes", "No"],
      }),
    ),
  ]);

  const events = [
    // The oldest event of all.
    event(`evt_${tag}_broken`, "civic.process.result_published", brokenId, {
      process: { type: "civic.meeting_summary" },
    }),
    ...["comment_removed", "comment_restored", "announcement_removed"].map((action, i) =>
      event(`evt_${tag}_mod${i}`, "civic.process.updated", modTargetId, {
        process: { type: "civic.announcement" },
        moderation: { action, reason: `reason ${i}` },
      }, true),
    ),
    ...Array.from({ length: VOTES }, (_, i) =>
      event(startedId(i), "civic.process.started", voteId(i), { process: { type: "civic.vote" } }),
    ),
    // The newest: ballots on the newest vote, none of them a card.
    ...Array.from({ length: BALLOTS }, (_, i) =>
      event(`evt_${tag}_b${i}`, "civic.process.vote_submitted", voteId(VOTES - 1), {
        process: { type: "civic.vote" },
      }),
    ),
  ];
  await post("events", events);
}, 120_000);

afterAll(async () => {
  // Events are append-only, so the hub stays; suspended, no job or request
  // reaches it again.
  await localRest(`hubs?id=eq.${HUB}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "suspended" }),
  }).catch(() => undefined);
});

describe("a hub with more than 1,000 events", () => {
  it("has them: more than the server returns in one answer", async () => {
    const { getEventCount } = await import("../../src/events/eventStore.js");
    expect(await onHub(() => getEventCount())).toBe(1 + 3 + VOTES + BALLOTS);
  });

  it("a page load gets one small page, and a cursor for the rest", async () => {
    const res = await call("GET", "/feed", HOST);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.events).toHaveLength(25);
    expect(res.body.count).toBe(25);
    expect(typeof res.body.next_cursor).toBe("string");
    // Cards only: the 400 newer ballots are not in it.
    for (const e of res.body.events) expect(e.event_type).toBe("civic.process.started");
    expect(res.body.events[0].id).toBe(startedId(VOTES - 1));
    // Card metadata for this page's processes only.
    expect(Object.keys(res.body.process_meta ?? {}).length).toBeLessThanOrEqual(25);
  });

  it("the feed's pages, followed to the end, hold every card once, oldest included", async () => {
    const ids: string[] = [];
    const times: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const res = await call("GET", `/feed?limit=100${q}`, HOST);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.events.length).toBeLessThanOrEqual(100);
      for (const e of res.body.events) {
        ids.push(e.id);
        times.push(e.timestamp);
      }
      cursor = res.body.next_cursor;
      pages++;
      expect(pages).toBeLessThan(30);
    } while (cursor);

    expect(new Set(ids).size).toBe(ids.length);
    const started = ids.filter((id) => id.startsWith(`evt_${tag}_s`));
    expect(started).toHaveLength(VOTES);
    expect(ids).toContain(startedId(0));
    // Newest first, across page boundaries.
    expect([...times].sort().reverse()).toEqual(times);
    // Restricted moderation events never reach a signed-out reader.
    expect(ids.filter((id) => id.includes("_mod"))).toEqual([]);
  });

  it("a filter pill pages on the server too", async () => {
    const res = await call("GET", "/feed?surface=announcement", HOST);
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
    expect(res.body.next_cursor).toBeNull();
    expect((await call("GET", "/feed?surface=nonsense", HOST)).status).toBe(400);
    expect((await call("GET", "/feed?cursor=not-a-cursor", HOST)).status).toBe(400);
  });

  it("an explicit lookup of the busiest process pages past the cap's worth of ballots", async () => {
    const pid = voteId(VOTES - 1);
    const res = await call("GET", `/feed?process_id=${pid}&limit=100`, HOST);
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(100);
    expect(res.body.next_cursor).toBeTruthy();
  });

  it("the moderation log holds every action, the oldest included", async () => {
    const token = await mintSession(HUB, ADMIN);
    const res = await call("GET", "/admin/moderation/log", HOST, undefined, token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.entries.map((e: { event_id: string }) => e.event_id)).toEqual([
      `evt_${tag}_mod2`,
      `evt_${tag}_mod1`,
      `evt_${tag}_mod0`,
    ]);
    expect(res.body.entries[2]).toMatchObject({ action: "comment_removed", process_title: `Moderated ${tag}` });
  });

  it("feed health checks every publication, the oldest included", async () => {
    const { findBrokenPublications } = await import("../../src/services/feedHealth.js");
    const broken = await onHub(() => findBrokenPublications());
    expect(broken.map((b) => b.process_id)).toEqual([brokenId]);
    expect(broken[0]).toMatchObject({ process_type: "civic.meeting_summary", title: `Broken summary ${tag}` });
  });

  it("the guard refuses a new unbounded read, and readAll reads it whole", async () => {
    const { forHub, ROW_CAP_CODE } = await import("../../src/db/forHub.js");
    const { readAll } = await import("../../src/db/readAll.js");
    const err = await onHub(() => forHub(HUB).from("events").select("id").then(() => null, (e: unknown) => e));
    expect(err).toMatchObject({ code: ROW_CAP_CODE });
    const all = await onHub(() =>
      readAll((from, to) => forHub(HUB).from("events").select<{ id: string }>("id").order("id").range(from, to)),
    );
    expect(all).toHaveLength(1 + 3 + VOTES + BALLOTS);
  });
});
