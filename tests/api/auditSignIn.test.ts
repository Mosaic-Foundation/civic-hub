// Audit 2 (2026-10-11): sign-in that can't be brute-forced or abused, and demo
// sessions that can never become privileged sessions.
//
// Two hubs the console creates for this file, so Athens and Floyd are
// untouched: a DEMO hub (any six digits for ordinary visitors) and a BETA hub
// (every code is real). Both are archived in afterAll.
//
// Needs the console's env, like tests/api/control.test.ts.

import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintDemoSession, mintSession, plantHubCode } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";
import { freshTestIp } from "../fixtures/helpers.js";

const run = Date.now().toString(36);
const DEMO = `a2d-${run}`;
const DEMO_HOST = `${DEMO}.localhost`;
const BETA = `a2b-${run}`;
const BETA_HOST = `${BETA}.localhost`;
const DEMO_ADMIN = `a2d-admin-${run}@example.test`;
const BETA_ADMIN = `a2b-admin-${run}@example.test`;
let cookie = "";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

async function stepCode(): Promise<string> {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantCode("step_up", code);
  return code;
}

async function createHub(slug: string, host: string, admin: string, mode: "demo" | "beta"): Promise<void> {
  const res = await consoleCall("POST", "/control/hubs", {
    cookie,
    body: { slug, name: `Audit Two ${mode}`, hostname: host, admin_email: admin, hub_kind: "organization", mode },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

async function pendingRow(hub: string, email: string): Promise<{ code: string | null; code_hash: string; attempts: number; locked_until: string | null } | undefined> {
  const rows = (await localRest(
    `pending_verifications?select=code,code_hash,attempts,locked_until&hub_id=eq.${hub}&email=eq.${encodeURIComponent(email)}`,
  )) as Array<{ code: string | null; code_hash: string; attempts: number; locked_until: string | null }>;
  return rows[0];
}

async function sessionRows(hub: string, tokenHash: string): Promise<Array<{ assurance: string }>> {
  return (await localRest(`sessions?select=assurance&hub_id=eq.${hub}&token=eq.${tokenHash}`)) as Array<{ assurance: string }>;
}

/** A demo hub's any-six-digits sign-in, through the API. */
async function demoSignIn(email: string): Promise<string> {
  const ip = freshTestIp();
  await call("POST", "/auth/request-code", DEMO_HOST, { email }, undefined, ip);
  const res = await call("POST", "/auth/verify", DEMO_HOST, { email, code: "123456" }, undefined, ip);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.token as string;
}

async function setSetting(hub: string, key: string, value: string): Promise<void> {
  await localRest("hub_settings?on_conflict=hub_id,key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ hub_id: hub, key, value, updated_by: "test" }),
  });
}

beforeAll(async () => {
  cookie = await mintConsoleSession();
  await createHub(DEMO, DEMO_HOST, DEMO_ADMIN, "demo");
  await createHub(BETA, BETA_HOST, BETA_ADMIN, "beta");
});

afterAll(async () => {
  for (const slug of [DEMO, BETA]) {
    await consoleCall("POST", `/control/hubs/${slug}/archive`, { cookie, body: { step_up_code: await stepCode() } });
  }
});

describe("codes and sessions are stored only as hashes", () => {
  it("a requested code is kept as its hash, and a session as its token's hash", async () => {
    const email = `hash-${run}@example.test`;
    // The beta hub refuses a request from someone on no list, so plant the
    // code as the request would have, then check what a real request stores
    // on the demo hub for its (privileged) admin.
    const requested = await call("POST", "/auth/request-code", DEMO_HOST, { email: DEMO_ADMIN });
    expect(requested.status, JSON.stringify(requested.body)).toBe(200);
    const stored = await pendingRow(DEMO, DEMO_ADMIN);
    expect(stored?.code).toBeNull();
    expect(stored?.code_hash).toMatch(/^[0-9a-f]{64}$/);

    await plantHubCode(BETA, email, "482913");
    const res = await call("POST", "/auth/verify", BETA_HOST, { email, code: "482913" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const token = res.body.token as string;
    expect(token.length).toBeGreaterThanOrEqual(43); // 256 bits, base64url
    expect(await sessionRows(BETA, sha256(token))).toEqual([{ assurance: "code" }]);
    expect((await localRest(`sessions?select=token&token=eq.${encodeURIComponent(token)}`)) as unknown[]).toEqual([]);
    expect((await call("GET", "/auth/me", BETA_HOST, undefined, token)).status).toBe(200);
  });
});

describe("the wrong-code counter is atomic", () => {
  it("twenty wrong guesses at once spend exactly five attempts, then the address is locked", async () => {
    const email = `race-${run}@example.test`;
    await plantHubCode(BETA, email, "735102");
    const results = await Promise.all(
      Array.from({ length: 20 }, () => call("POST", "/auth/verify", BETA_HOST, { email, code: "000001" })),
    );
    // A wrong guess is 400; once locked, 429 locked_out (Audit 4).
    for (const r of results) expect([400, 429]).toContain(r.status);
    expect(results.filter((r) => r.status === 429).every((r) => r.body.code === "locked_out")).toBe(true);
    const row = await pendingRow(BETA, email);
    expect(row?.attempts).toBe(5);
    expect(row?.locked_until && Date.parse(row.locked_until) > Date.now()).toBe(true);
    expect(results.filter((r) => r.body.error === "Invalid verification code")).toHaveLength(4);

    // The right code is refused now, and a fresh code can't be requested.
    const right = await call("POST", "/auth/verify", BETA_HOST, { email, code: "735102" });
    expect(right.status).toBe(429);
    expect(right.body.code).toBe("locked_out");
    expect(String(right.body.error)).toMatch(/too many/i);
  });

  it("of six requests with the right code at once, one signs in", async () => {
    const email = `once-${run}@example.test`;
    await plantHubCode(BETA, email, "604218");
    const results = await Promise.all(
      Array.from({ length: 6 }, () => call("POST", "/auth/verify", BETA_HOST, { email, code: "604218" })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });
});

describe("per-IP and per-address limits", () => {
  it("an IP may ask for 20 codes an hour", async () => {
    const ip = freshTestIp();
    for (let i = 0; i < 20; i++) {
      const r = await call("POST", "/auth/request-code", DEMO_HOST, { email: `ipreq-${i}-${run}@example.test` }, undefined, ip);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const refused = await call("POST", "/auth/request-code", DEMO_HOST, { email: `ipreq-x-${run}@example.test` }, undefined, ip);
    expect(refused.status).toBe(429);
    // Another network is unaffected.
    expect((await call("POST", "/auth/request-code", DEMO_HOST, { email: `ipreq-y-${run}@example.test` })).status).toBe(200);
  });

  it("the IP limit holds across hubs", async () => {
    const ip = freshTestIp();
    for (let i = 0; i < 20; i++) {
      const host = i % 2 ? DEMO_HOST : BETA_HOST;
      await call("POST", "/auth/request-code", host, { email: `cross-${i}-${run}@example.test` }, undefined, ip);
    }
    expect((await call("POST", "/auth/request-code", DEMO_HOST, { email: `cross-x-${run}@example.test` }, undefined, ip)).status).toBe(429);
  });

  it("an IP may try 40 codes an hour", async () => {
    const ip = freshTestIp();
    for (let i = 0; i < 40; i++) {
      const r = await call("POST", "/auth/verify", BETA_HOST, { email: `ipver-${i}-${run}@example.test`, code: "111111" }, undefined, ip);
      expect(r.status).toBe(400); // no code waiting
    }
    const refused = await call("POST", "/auth/verify", BETA_HOST, { email: `ipver-x-${run}@example.test`, code: "111111" }, undefined, ip);
    expect(refused.status).toBe(429);
    expect(String(refused.body.error)).toMatch(/too many sign-in attempts/i);
  });

  it("an address may be sent five codes an hour, from anywhere", async () => {
    // On the beta hub this address is on no list: each request answers 403
    // beta_closed ("private beta"; 400 before Audit 4) and still counts, so the
    // sixth is refused for the address, whichever network it comes from.
    const email = `addr-${run}@example.test`;
    for (let i = 0; i < 5; i++) {
      expect((await call("POST", "/auth/request-code", BETA_HOST, { email })).status).toBe(403);
    }
    const refused = await call("POST", "/auth/request-code", BETA_HOST, { email });
    expect(refused.status).toBe(429);
    expect(String(refused.body.error)).toMatch(/this address/i);
  });

  it("the console allows five code requests per IP an hour", async () => {
    const ip = freshTestIp();
    for (let i = 0; i < 5; i++) {
      const r = await consoleCall("POST", "/control/auth/request-code", { body: { email: `nobody-${i}@example.test` }, ip });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const refused = await consoleCall("POST", "/control/auth/request-code", { body: { email: "nobody@example.test" }, ip });
    expect(refused.status).toBe(429);
  });

  it("the console's and the start page's code checks are atomic too", async () => {
    // Straight at the functions, on rows of this test's own, so the operator's
    // real sign-in (used by other files running alongside) is never locked.
    const email = `atomic-${run}@example.test`;
    const hash = sha256("193846");
    const expires = new Date(Date.now() + 600_000).toISOString();
    await localRest("control_codes", {
      method: "POST",
      body: JSON.stringify({ email, purpose: "sign_in", code_hash: hash, expires_at: expires, attempts: 0 }),
    });
    await localRest("start_codes", {
      method: "POST",
      body: JSON.stringify({ email, code_hash: hash, expires_at: expires, attempts: 0 }),
    });
    const control = await Promise.all(
      Array.from({ length: 12 }, () =>
        localRest("rpc/take_control_code_attempt", {
          method: "POST",
          body: JSON.stringify({ p_email: email, p_purpose: "sign_in", p_max: 5, p_lock_seconds: 900 }),
        }) as Promise<unknown[]>,
      ),
    );
    const start = await Promise.all(
      Array.from({ length: 12 }, () =>
        localRest("rpc/take_start_code_attempt", {
          method: "POST",
          body: JSON.stringify({ p_email: email, p_max: 5, p_lock_seconds: 900 }),
        }) as Promise<unknown[]>,
      ),
    );
    expect(control.filter((rows) => rows.length === 1)).toHaveLength(5);
    expect(start.filter((rows) => rows.length === 1)).toHaveLength(5);
    await localRest(`control_codes?email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
    await localRest(`start_codes?email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
  });
});

describe("a demo session never carries a privilege", () => {
  it("a demo session for an admin's address is not a session", async () => {
    // A privileged address never gets one from sign-in; this is the row as if
    // it had been minted before the address was made an admin.
    const token = await mintDemoSession(DEMO, DEMO_ADMIN);
    expect((await call("GET", "/auth/me", DEMO_HOST, undefined, token)).status).toBe(401);
    expect((await call("GET", "/admin/hub/settings", DEMO_HOST, undefined, token)).status).toBe(401);
  });

  it("a demo sign-in for an address that later becomes an admin is ended, not promoted", async () => {
    const email = `later-admin-${run}@example.test`;
    const token = await demoSignIn(email);
    expect((await call("GET", "/auth/me", DEMO_HOST, undefined, token)).status).toBe(200);
    expect(await sessionRows(DEMO, sha256(token))).toEqual([{ assurance: "demo" }]);

    await setSetting(DEMO, "people.admin_emails", JSON.stringify([DEMO_ADMIN, email]));

    expect(await sessionRows(DEMO, sha256(token))).toEqual([]);
    expect((await call("GET", "/auth/me", DEMO_HOST, undefined, token)).status).toBe(401);
    expect((await call("GET", "/admin/hub/settings", DEMO_HOST, undefined, token)).status).toBe(401);
    // Signing in again on any six digits is refused for an admin.
    const again = await call("POST", "/auth/verify", DEMO_HOST, { email, code: "123456" });
    expect(again.status).toBe(400);
    await setSetting(DEMO, "people.admin_emails", JSON.stringify([DEMO_ADMIN]));
  });

  it("…and the same for the board, the announcement authors and an official", async () => {
    const board = `board-${run}@example.test`;
    const author = `author-${run}@example.test`;
    const official = `official-${run}@example.test`;
    const [tBoard, tAuthor, tOfficial] = [await demoSignIn(board), await demoSignIn(author), await demoSignIn(official)];

    await setSetting(DEMO, "people.board_emails", JSON.stringify([board]));
    await setSetting(DEMO, "people.announcement_authors", JSON.stringify([{ email: author.toUpperCase(), label: "Clerk" }]));
    await localRest(`users?hub_id=eq.${DEMO}&email=eq.${encodeURIComponent(official)}`, {
      method: "PATCH",
      body: JSON.stringify({ official_type: "other", official_title: "Clerk" }),
    });

    for (const t of [tBoard, tAuthor, tOfficial]) {
      expect(await sessionRows(DEMO, sha256(t))).toEqual([]);
      expect((await call("GET", "/auth/me", DEMO_HOST, undefined, t)).status).toBe(401);
    }
  });

  it("an admin's code session is untouched by a roster write", async () => {
    const token = await mintSession(DEMO, DEMO_ADMIN);
    await setSetting(DEMO, "people.admin_emails", JSON.stringify([DEMO_ADMIN]));
    const me = await call("GET", "/auth/me", DEMO_HOST, undefined, token);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe("admin");
  });
});

describe("leaving demo mode", () => {
  it("ends the hub's demo sessions and keeps its admin signed in", async () => {
    const visitor = await demoSignIn(`visitor-${run}@example.test`);
    const admin = await mintSession(DEMO, DEMO_ADMIN);
    await plantHubCode(DEMO, DEMO_ADMIN, "550931");

    const res = await call("POST", "/admin/hub/mode", DEMO_HOST, { mode: "beta", code: "550931" }, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect(await sessionRows(DEMO, sha256(visitor))).toEqual([]);
    expect((await call("GET", "/auth/me", DEMO_HOST, undefined, visitor)).status).toBe(401);
    expect((await call("GET", "/auth/me", DEMO_HOST, undefined, admin)).status).toBe(200);
    // Any six digits no longer works.
    const again = await call("POST", "/auth/verify", DEMO_HOST, { email: `visitor-${run}@example.test`, code: "123456" });
    expect(again.status).toBe(400);
  });
});
