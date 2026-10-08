// Sample content (Phase 7), against the local stack and the running server.
//
// Two halves:
//  - The database, on its own terms (a service-role client and a minted hub
//    token straight at PostgREST, like leakHarnessDb.test.ts), so it holds in
//    both CI passes: an event on a sample process is stamped sample; a
//    process spawned from one inherits it; the hub-token role can delete a
//    sample event but not a real one; hub_admin_audit_log is append-only.
//  - The app, on Athens (the demo hub): sample events stay off GET /events
//    and /activities/:id but are in the hub's feed with `sample: true`; the
//    removal warning counts real people's input; removal takes a fresh code,
//    deletes exactly the sample content, and is audited.
//
// The fixtures are written as the service role rather than by the seed, so
// this file tests the marker and removal whatever the templates say. The seed
// itself is covered where it is wired (seed-sample-content.ts).
// LOCAL ONLY (localStack() refuses anything else). Needs `supabase start`.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request } from "node:http";
import { randomBytes } from "node:crypto";
import { API_BASE } from "../fixtures/helpers.js";
import { localRest, localStack, mintSession } from "../fixtures/adminSession.js";
import { parseSigningKey, signHubToken } from "../../src/db/hubToken.js";

const LOCAL_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const LOCAL_PUBLISHABLE_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const { url } = localStack();
const signer = parseSigningKey(process.env.CIVIC_HUB_SIGNING_KEY?.trim() || LOCAL_JWT_SECRET);
const apikey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || LOCAL_PUBLISHABLE_KEY;

const ATHENS = "athens.localhost";
const ATHENS_ADMIN = "admin+athens@example.test";
const run = randomBytes(4).toString("hex");

type Result = { status: number; body: any };

/** PostgREST as the Athens hub token (the role the hub app runs as with tokens on). */
async function asAthensToken(path: string, init: RequestInit = {}): Promise<Result> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey,
      Authorization: `Bearer ${signHubToken(signer, "athens")}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** The app on a hostname (node:http: `Host` is forbidden for fetch). */
function call(method: string, path: string, body?: unknown, token?: string): Promise<Result> {
  const u = new URL(`${API_BASE}${path}`);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          Accept: "application/json",
          Host: ATHENS,
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : {} });
          } catch {
            reject(new Error(`unparseable (${res.statusCode}): ${raw.slice(0, 120)}`));
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// --- Fixtures -------------------------------------------------------------------

const SAMPLE_PROC = `proc_sample_athens_t${run}`;
const SPAWNED_PROC = `proc_sample_spawn_t${run}`;
const REAL_PROC = `proc_real_athens_t${run}`;
const SAMPLE_USER = `user_sample_athens_t${run}`;
const REAL_USER = `user_real_athens_t${run}`;
const ev = (suffix: string) => `evt_sample_t${run}_${suffix}`;
// Review history (2026-10-07, session 3b): a real process under review, left
// behind on purpose (its turns are append-only, so nothing can delete it; it
// stays pending_review, out of every list), and reviews on the sample one.
const REVIEWED_PROC = `proc_real_reviewed_t${run}`;
const REAL_REVIEW = `rev_real_t${run}`;
const SAMPLE_REVIEW = `rev_sample_t${run}`;
const turn = (suffix: string) => `turn_t${run}_${suffix}`;

function eventRow(id: string, processId: string, actor: string) {
  return {
    id,
    hub_id: "athens",
    version: "1.0",
    event_type: "civic.process.updated",
    process_id: processId,
    actor,
    jurisdiction: "test",
    action_url: `http://athens.localhost/process/${processId}`,
    source: { hub_id: "civic-hub-athens", hub_url: "http://athens.localhost" },
    data: { process: { type: "civic.announcement" } },
    meta: { visibility: "public" },
    created_at: new Date().toISOString(),
  };
}

const proc = (id: string, isSample: boolean, state: Record<string, unknown> = {}) => ({
  id,
  hub_id: "athens",
  type: "civic.announcement",
  title: `Sample test ${id}`,
  description: "fixture",
  status: "active",
  state: {
    type: "civic.announcement",
    content: { title: `Sample test ${id}`, body: "fixture", links: [] },
    author_id: "user_fixture",
    author_role: "admin",
    author_display_name: null,
    created_at: new Date().toISOString(),
    last_edited_at: null,
    edit_count: 0,
    ...state,
  },
  is_sample: isSample,
});

let admin = "";

beforeAll(async () => {
  admin = await mintSession("athens", ATHENS_ADMIN);
  await localRest("users", {
    method: "POST",
    body: JSON.stringify([
      { id: SAMPLE_USER, hub_id: "athens", email: `sample-${run}@example.invalid`, email_verified: true, is_resident: true, full_name: "Sample T.", is_sample: true },
      { id: REAL_USER, hub_id: "athens", email: `real-${run}@example.test`, email_verified: true, is_resident: true, full_name: "Real Resident", is_sample: false },
    ]),
  });
  await localRest("processes", { method: "POST", body: JSON.stringify([proc(SAMPLE_PROC, true), proc(REAL_PROC, false)]) });
  await localRest("events", {
    method: "POST",
    body: JSON.stringify([
      eventRow(ev("s1"), SAMPLE_PROC, SAMPLE_USER),
      eventRow(ev("s2"), SAMPLE_PROC, REAL_USER),
      eventRow(ev("r1"), REAL_PROC, REAL_USER),
    ]),
  });
  // A real person's comment on the sample process, and a sample author's.
  await localRest("community_inputs", {
    method: "POST",
    body: JSON.stringify([
      { id: `ci_t${run}_real`, hub_id: "athens", process_id: SAMPLE_PROC, author_id: REAL_USER, body: "A real comment", phase: "proposal" },
      { id: `ci_t${run}_sample`, hub_id: "athens", process_id: SAMPLE_PROC, author_id: SAMPLE_USER, body: "A sample comment", phase: "proposal" },
    ]),
  });
});

afterAll(async () => {
  // Real fixtures: the service role may delete real events (the guard binds
  // only the hub-token role).
  await localRest(`community_inputs?id=like.ci_t${run}*`, { method: "DELETE" }).catch(() => undefined);
  await localRest(`events?id=like.evt_sample_t${run}*`, { method: "DELETE" }).catch(() => undefined);
  await localRest(`processes?id=in.(${SAMPLE_PROC},${SPAWNED_PROC},${REAL_PROC})`, { method: "DELETE" }).catch(() => undefined);
  await localRest(`sessions?user_id=in.(${SAMPLE_USER},${REAL_USER})`, { method: "DELETE" }).catch(() => undefined);
  await localRest(`users?id=in.(${SAMPLE_USER},${REAL_USER})`, { method: "DELETE" }).catch(() => undefined);
});

// --- The database -----------------------------------------------------------------

describe("the database stamps the marker", () => {
  it("marks every event of a sample process, whoever wrote it", async () => {
    const rows = (await localRest(`events?select=id,is_sample&id=like.evt_sample_t${run}*&order=id`)) as Array<{ id: string; is_sample: boolean }>;
    expect(Object.fromEntries(rows.map((r) => [r.id, r.is_sample]))).toEqual({
      [ev("r1")]: false,
      [ev("s1")]: true,
      [ev("s2")]: true, // a real resident's action on a sample process
    });
  });

  it("marks a process spawned from a sample process", async () => {
    await localRest("processes", {
      method: "POST",
      body: JSON.stringify(proc(SPAWNED_PROC, false, { source_process_id: SAMPLE_PROC })),
    });
    const [row] = (await localRest(`processes?select=is_sample&id=eq.${SPAWNED_PROC}`)) as Array<{ is_sample: boolean }>;
    expect(row.is_sample).toBe(true);
  });
});

describe("events stay append-only for the hub app", () => {
  it("refuses the hub-token role deleting a real event", async () => {
    const res = await asAthensToken(`events?id=eq.${ev("r1")}`, { method: "DELETE" });
    expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
    const still = (await localRest(`events?select=id&id=eq.${ev("r1")}`)) as unknown[];
    expect(still).toHaveLength(1);
  });

  it("lets the hub-token role delete a sample event", async () => {
    const extra = ev("s3");
    await localRest("events", { method: "POST", body: JSON.stringify(eventRow(extra, SAMPLE_PROC, SAMPLE_USER)) });
    const res = await asAthensToken(`events?id=eq.${extra}`, { method: "DELETE" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toHaveLength(1);
    expect((await localRest(`events?select=id&id=eq.${extra}`)) as unknown[]).toHaveLength(0);
  });

  // No role is granted UPDATE or DELETE on it, and the trigger refuses both
  // for any role that has them (the owner): either refusal will do.
  it("keeps hub_admin_audit_log append-only, even for the service role", async () => {
    const [row] = (await localRest("hub_admin_audit_log", {
      method: "POST",
      body: JSON.stringify({ hub_id: "athens", actor_email: "test@example.test", action: "test.append_only" }),
    })) as Array<{ id: string }>;
    await expect(
      localRest(`hub_admin_audit_log?id=eq.${row.id}`, { method: "PATCH", body: JSON.stringify({ action: "x" }) }),
    ).rejects.toThrow(/append-only|permission denied/);
    await expect(localRest(`hub_admin_audit_log?id=eq.${row.id}`, { method: "DELETE" })).rejects.toThrow(
      /append-only|permission denied/,
    );
  });
});

describe("review history: only a sample process's turns may be deleted, and the marker is set only at insert", () => {
  const turnRow = (id: string, reviewId: string, n: number, extra: Record<string, unknown> = {}) => ({
    id,
    hub_id: "athens",
    review_id: reviewId,
    turn_number: n,
    actor: REAL_USER,
    actor_role: "creator",
    action: "submit",
    ...extra,
  });

  beforeAll(async () => {
    await localRest("processes", {
      method: "POST",
      body: JSON.stringify({ ...proc(REVIEWED_PROC, false), status: "pending_review" }),
    });
    const review = (id: string, processId: string) => ({
      id,
      hub_id: "athens",
      process_id: processId,
      creator_id: REAL_USER,
      creator_name: "Real Resident",
      creator_email: `real-${run}@example.test`,
    });
    await localRest("process_reviews", {
      method: "POST",
      body: JSON.stringify([review(REAL_REVIEW, REVIEWED_PROC), review(SAMPLE_REVIEW, SAMPLE_PROC)]),
    });
    // A client that claims a real turn is sample: the database decides.
    await localRest("review_turns", {
      method: "POST",
      body: JSON.stringify(turnRow(turn("real"), REAL_REVIEW, 1, { is_sample: true })),
    });
    await localRest("review_turns", {
      method: "POST",
      body: JSON.stringify([turnRow(turn("s1"), SAMPLE_REVIEW, 1), turnRow(turn("s2"), SAMPLE_REVIEW, 2)]),
    });
  });

  it("stamps each turn from its review's process, whatever the client sent", async () => {
    const rows = (await localRest(`review_turns?select=id,is_sample&id=like.turn_t${run}*&order=id`)) as Array<{
      id: string;
      is_sample: boolean;
    }>;
    expect(Object.fromEntries(rows.map((r) => [r.id, r.is_sample]))).toEqual({
      [turn("real")]: false,
      [turn("s1")]: true,
      [turn("s2")]: true,
    });
  });

  it("lets the hub-token role delete a sample turn", async () => {
    const res = await asAthensToken(`review_turns?id=eq.${turn("s1")}`, { method: "DELETE" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toHaveLength(1);
    expect((await localRest(`review_turns?select=id&id=eq.${turn("s1")}`)) as unknown[]).toHaveLength(0);
  });

  it("refuses deleting a real turn, for the hub-token role and the service role", async () => {
    const res = await asAthensToken(`review_turns?id=eq.${turn("real")}`, { method: "DELETE" });
    expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
    await expect(localRest(`review_turns?id=eq.${turn("real")}`, { method: "DELETE" })).rejects.toThrow(/append-only/);
    // Nor by deleting its review: the cascade meets the same guard.
    await expect(localRest(`process_reviews?id=eq.${REAL_REVIEW}`, { method: "DELETE" })).rejects.toThrow(/append-only/);
    expect((await localRest(`review_turns?select=id&id=eq.${turn("real")}`)) as unknown[]).toHaveLength(1);
  });

  it("refuses turning the marker on later: on a turn, or on a real process", async () => {
    await expect(
      localRest(`review_turns?id=eq.${turn("real")}`, { method: "PATCH", body: JSON.stringify({ is_sample: true }) }),
    ).rejects.toThrow(/append-only/);
    for (const marker of ["is_sample", "added_in_demo"]) {
      await expect(
        localRest(`processes?id=eq.${REVIEWED_PROC}`, { method: "PATCH", body: JSON.stringify({ [marker]: true }) }),
        marker,
      ).rejects.toThrow(/set only when a process is created/);
      const byToken = await asAthensToken(`processes?id=eq.${REVIEWED_PROC}`, {
        method: "PATCH",
        body: JSON.stringify({ [marker]: true }),
      });
      expect(byToken.status, marker).toBeGreaterThanOrEqual(400);
    }
    const [row] = (await localRest(`processes?select=is_sample,added_in_demo&id=eq.${REVIEWED_PROC}`)) as Array<{
      is_sample: boolean;
      added_in_demo: boolean;
    }>;
    expect(row).toEqual({ is_sample: false, added_in_demo: false });
    // And the real turn is still not deletable.
    await expect(localRest(`review_turns?id=eq.${turn("real")}`, { method: "DELETE" })).rejects.toThrow(/append-only/);
  });
});

// --- The app ------------------------------------------------------------------------

describe("sample events are not public record", () => {
  it("leaves them off GET /events", async () => {
    const { status, body } = await call("GET", `/events?page=true&context=${SAMPLE_PROC}`);
    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toContain(ev("s1"));
    const real = await call("GET", `/events?page=true&context=${REAL_PROC}`);
    expect(JSON.stringify(real.body)).toContain(ev("r1"));
  });

  it("does not serve one by id", async () => {
    expect((await call("GET", `/activities/${ev("s1")}`)).status).toBe(404);
    expect((await call("GET", `/activities/${ev("r1")}`)).status).toBe(200);
  });

  it("shows them in the hub's own feed, marked sample", async () => {
    // Per process: since 2026-10-07 the feed's page holds cards only, and
    // these planted events (process.updated) are not cards.
    const byId = new Map<string, { id: string; sample?: boolean }>();
    for (const pid of [SAMPLE_PROC, REAL_PROC]) {
      const { status, body } = await call("GET", `/api/feed?process_id=${pid}&limit=100`);
      expect(status).toBe(200);
      for (const e of body.events as Array<{ id: string; sample?: boolean }>) byId.set(e.id, e);
    }
    expect(byId.get(ev("s1"))?.sample).toBe(true);
    expect(byId.has(ev("r1"))).toBe(true);
    expect(byId.get(ev("r1"))?.sample).toBeUndefined();
  });

  it("marks the process itself on its read model", async () => {
    const { status, body } = await call("GET", `/process/${SAMPLE_PROC}/state`);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.is_sample).toBe(true);
    const real = await call("GET", `/process/${REAL_PROC}/state`);
    expect(real.body.is_sample).toBeUndefined();
  });
});

describe("removing the sample content", () => {
  it("is admin-only", async () => {
    expect((await call("GET", "/admin/hub/sample-content")).status).toBe(401);
    const resident = await mintSession("athens", `sample-resident-${run}@example.com`);
    expect((await call("GET", "/admin/hub/sample-content", undefined, resident)).status).toBe(403);
  });

  it("warns with what it takes, counting real people's input", async () => {
    const { status, body } = await call("GET", "/admin/hub/sample-content", undefined, admin);
    expect(status).toBe(200);
    expect(body.processes).toBeGreaterThanOrEqual(2); // the fixture and its spawn
    expect(body.real_input.comment).toBeGreaterThanOrEqual(1); // the real comment, not the sample author's
    expect(body.other_processes).toBeGreaterThanOrEqual(1);
  });

  it("refuses without a fresh code", async () => {
    const { status } = await call("POST", "/admin/hub/sample-content/remove", {}, admin);
    expect(status).toBe(400);
    const [row] = (await localRest(`processes?select=id&id=eq.${SAMPLE_PROC}`)) as unknown[];
    expect(row).toBeDefined();
  });

  it("deletes exactly the sample content, and records who did it", async () => {
    // A fresh code, as the emailed step-up would have stored it.
    const code = String(100000 + Math.floor(Math.random() * 899999));
    await localRest("pending_verifications", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        hub_id: "athens",
        email: ATHENS_ADMIN,
        code,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        attempts: 0,
      }),
    });
    const { status, body } = await call("POST", "/admin/hub/sample-content/remove", { code }, admin);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.summary.processes).toBe(0);

    // Gone: the sample processes, their events and comments (the real
    // person's too), the sample author.
    expect((await localRest(`processes?select=id&id=in.(${SAMPLE_PROC},${SPAWNED_PROC})`)) as unknown[]).toHaveLength(0);
    expect((await localRest(`events?select=id&process_id=eq.${SAMPLE_PROC}`)) as unknown[]).toHaveLength(0);
    expect((await localRest(`community_inputs?select=id&id=like.ci_t${run}*`)) as unknown[]).toHaveLength(0);
    expect((await localRest(`users?select=id&id=eq.${SAMPLE_USER}`)) as unknown[]).toHaveLength(0);
    // The sample process's review history went with it; the real one stayed.
    expect((await localRest(`review_turns?select=id&review_id=eq.${SAMPLE_REVIEW}`)) as unknown[]).toHaveLength(0);
    expect((await localRest(`review_turns?select=id&id=eq.${turn("real")}`)) as unknown[]).toHaveLength(1);

    // Kept: the real process, its event, the real person.
    expect((await localRest(`processes?select=id&id=eq.${REAL_PROC}`)) as unknown[]).toHaveLength(1);
    expect((await localRest(`events?select=id&id=eq.${ev("r1")}`)) as unknown[]).toHaveLength(1);
    expect((await localRest(`users?select=id&id=eq.${REAL_USER}`)) as unknown[]).toHaveLength(1);

    // Audited, in the hub's own log.
    const audit = (await localRest(
      `hub_admin_audit_log?select=actor_email,action,before&hub_id=eq.athens&action=eq.sample_content.remove&order=at.desc&limit=1`,
    )) as Array<{ actor_email: string; action: string; before: { real_input_total: number } }>;
    expect(audit[0]?.actor_email).toBe(ATHENS_ADMIN);
    expect(audit[0]?.before.real_input_total).toBeGreaterThanOrEqual(1);

    // The hub still works, empty of samples.
    expect((await call("GET", "/api/feed")).status).toBe(200);
    expect((await call("GET", "/admin/hub/sample-content", undefined, admin)).body.processes).toBe(0);
  });
});
