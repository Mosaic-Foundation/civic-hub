// Invite codes and the start page (session 4b, 2026-10-08).
//
// Needs a server with CIVIC_START_HOSTNAME=start.localhost, as well as the
// console's CIVIC_CONSOLE_HOSTNAME=console.localhost and
// CIVIC_CONSOLE_ADMIN_EMAIL=operator@example.test (CI sets all three), on the
// local stack with 20261008010000 applied. Every hub this file creates is
// archived in afterAll, as control.test.ts does, so the per-hub job runs in
// crons.test.ts see only Floyd and Athens.
//
// Each test uses its own made-up client address (freshIp), so the hour's
// rate-limit buckets start empty on every run.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest } from "../fixtures/adminSession.js";
import { OPERATOR, auditFor, consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";
import { START_HOST, cookieFrom, freshIp, plantStartCode, signedInStart, startCall } from "../fixtures/startCall.js";

const run = Date.now().toString(36);
const created: string[] = [];
let consoleCookie = "";

/** The one answer for every code that cannot be used (src/control/entitlements.ts). */
const REFUSED = "That code can't be used. Check it, or ask the person who gave it to you for a new one.";

interface EntitlementRow {
  id: string;
  used: number;
  quantity: number;
  code_hash: string;
  code_hint: string;
  claimed_until: string | null;
  revoked_at: string | null;
}

async function mint(note = `for test ${run}`, days?: number): Promise<{ code: string; id: string }> {
  const res = await consoleCall("POST", "/control/invites", { cookie: consoleCookie, body: { note, ...(days ? { days } : {}) } });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { code: res.body.code, id: res.body.invite.id };
}

async function entitlement(id: string): Promise<EntitlementRow> {
  const rows = (await localRest(`entitlements?id=eq.${id}&select=*`)) as EntitlementRow[];
  return rows[0]!;
}

async function inviteAudit(id: string): Promise<Array<{ action: string; actor_email: string; after: any }>> {
  return (await localRest(
    `control_audit_log?after->>entitlement_id=eq.${id}&select=action,actor_email,target_hub_id,after&order=id.asc`,
  )) as Array<{ action: string; actor_email: string; after: any }>;
}

function hubBody(slug: string, extra: Record<string, unknown> = {}) {
  return { hub_kind: "other", name: `Start Test ${slug}`, slug, timezone: "America/New_York", ...extra };
}

async function stepCode(): Promise<string> {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantCode("step_up", code);
  return code;
}

beforeAll(async () => {
  consoleCookie = await mintConsoleSession();
});

afterAll(async () => {
  for (const id of created) {
    const res = await consoleCall("POST", `/control/hubs/${id}/archive`, {
      cookie: consoleCookie,
      body: { step_up_code: await stepCode() },
    });
    if (res.status !== 200 && !/already archived/.test(res.body.error ?? "")) {
      throw new Error(`could not archive ${id}: ${JSON.stringify(res.body)}`);
    }
  }
});

describe("the start page answers on its own hostname only", () => {
  it("is not reachable on a hub's or the console's hostname", async () => {
    const onHub = await startCall("GET", "/start/session", { host: "athens.localhost" });
    expect(onHub.status).toBe(404);
    expect(onHub.body.step).toBeUndefined();
    const onConsole = await startCall("GET", "/start/session", { host: "console.localhost" });
    expect(onConsole.status).toBe(404);
    expect(onConsole.body.step).toBeUndefined();
  });

  it("does not serve a hub's routes or the console's", async () => {
    expect((await startCall("GET", "/hub-config")).body).toEqual({ error: "not_found" });
    expect((await startCall("GET", "/control/session")).body).toEqual({ error: "not_found" });
  });

  it("refuses writes without its header, and steps past the code without a session", async () => {
    expect((await startCall("POST", "/start/invite", { csrf: false, body: { code: "x" }, ip: freshIp() })).status).toBe(403);
    const noSession = await startCall("POST", "/start/request-code", { body: { email: "a@example.test" }, ip: freshIp() });
    expect(noSession.status).toBe(401);
    expect((await startCall("GET", "/start/config")).status).toBe(401);
  });
});

describe("invite codes in the console", () => {
  it("mints a code shown once, stored only as a hash, and audited", async () => {
    const { code, id } = await mint(`Sam, planning ${run}`, 7);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    const row = await entitlement(id);
    expect(row).toMatchObject({ kind: "hub.create", quantity: 1, used: 0, source: "invite", code_hint: code.slice(-4) });
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(code.replace(/-/g, ""));
    const days = (Date.parse((row as unknown as { expires_at: string }).expires_at) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    const audit = await inviteAudit(id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "invite.mint", actor_email: OPERATOR });
    expect(audit[0]!.after.note).toBe(`Sam, planning ${run}`);
    expect(JSON.stringify(audit[0])).not.toContain(code);
  });

  it("defaults to 14 days, and refuses a lifetime out of range", async () => {
    const { id } = await mint();
    const row = (await entitlement(id)) as unknown as { expires_at: string };
    expect(Math.round((Date.parse(row.expires_at) - Date.now()) / 86_400_000)).toBe(14);
    const tooLong = await consoleCall("POST", "/control/invites", { cookie: consoleCookie, body: { days: 365 } });
    expect(tooLong.status).toBe(400);
  });

  it("lists codes with their status, never the code", async () => {
    const { code, id } = await mint();
    const res = await consoleCall("GET", "/control/invites", { cookie: consoleCookie });
    expect(res.status).toBe(200);
    expect(res.body.start_hostname).toBe(START_HOST);
    const mine = res.body.invites.find((i: { id: string }) => i.id === id);
    expect(mine).toMatchObject({ status: "unused", code_hint: code.slice(-4), redemptions: [] });
    expect(mine.code_hash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(code);
  });

  it("revokes an unused code, once, and audits it", async () => {
    const { id } = await mint();
    const res = await consoleCall("POST", `/control/invites/${id}/revoke`, { cookie: consoleCookie });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.invites.find((i: { id: string }) => i.id === id).status).toBe("revoked");
    const again = await consoleCall("POST", `/control/invites/${id}/revoke`, { cookie: consoleCookie });
    expect(again.status).toBe(400);
    expect((await inviteAudit(id)).map((a) => a.action)).toEqual(["invite.mint", "invite.revoke"]);
  });

  it("needs a console session", async () => {
    expect((await consoleCall("GET", "/control/invites")).status).toBe(401);
    expect((await consoleCall("POST", "/control/invites", { body: {} })).status).toBe(401);
  });
});

describe("a code that cannot be used gets one answer", () => {
  it("wrong, malformed, expired, revoked and used codes are refused alike", async () => {
    const ip = freshIp();
    const answers: Array<{ status: number; error: string }> = [];
    const ask = async (code: string) => {
      const r = await startCall("POST", "/start/invite", { body: { code }, ip });
      answers.push({ status: r.status, error: r.body.error });
      expect(r.setCookie).toBeUndefined();
    };

    await ask("ZZZZ-ZZZZ-ZZZZ"); // never minted
    await ask("not a code"); // malformed

    const expired = await mint();
    await localRest(`entitlements?id=eq.${expired.id}`, {
      method: "PATCH",
      body: JSON.stringify({ expires_at: new Date(Date.now() - 1000).toISOString() }),
    });
    await ask(expired.code);

    const revoked = await mint();
    await consoleCall("POST", `/control/invites/${revoked.id}/revoke`, { cookie: consoleCookie });
    await ask(revoked.code);

    const used = await mint();
    await localRest(`entitlements?id=eq.${used.id}`, { method: "PATCH", body: JSON.stringify({ used: 1 }) });
    await ask(used.code);

    for (const a of answers) expect(a).toEqual({ status: 403, error: REFUSED });
  });

  it("accepts a code typed loosely: lower case, spaces, O for 0, I or L for 1", async () => {
    const { code } = await mint();
    const loose = code.toLowerCase().replace(/-/g, " ").replace(/0/g, "o").replace(/1/g, "l");
    const r = await startCall("POST", "/start/invite", { body: { code: loose }, ip: freshIp() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ step: "sign_in" });
    expect(r.setCookie).toMatch(/^civic_start=[^;]+;/);
    expect(r.setCookie).toContain("HttpOnly");
    expect(r.setCookie).toContain("SameSite=Strict");
  });
});

describe("rate limits", () => {
  it("ten invite codes an hour from one address, then a refusal that is not counted", async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      const r = await startCall("POST", "/start/invite", { body: { code: "ZZZZ-ZZZZ-ZZZZ" }, ip });
      expect(r.status).toBe(403);
    }
    const { code } = await mint();
    const blocked = await startCall("POST", "/start/invite", { body: { code }, ip });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Too many tries/);
    // Another address is not affected, and the good code is still good.
    expect((await startCall("POST", "/start/invite", { body: { code }, ip: freshIp() })).status).toBe(200);
  });

  it("five sign-in codes an hour for one address, from anywhere", async () => {
    const { code } = await mint();
    const invite = await startCall("POST", "/start/invite", { body: { code }, ip: freshIp() });
    const cookie = cookieFrom(invite.setCookie);
    const email = `limited-${run}@example.test`;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      // The first sends; the next four meet the 30-second throttle, and count.
      statuses.push((await startCall("POST", "/start/request-code", { cookie, ip: freshIp(), body: { email } })).status);
    }
    expect(statuses[0]).toBe(200);
    const sixth = await startCall("POST", "/start/request-code", { cookie, ip: freshIp(), body: { email } });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toMatch(/Too many codes for that address/);
  });

  it("six sign-in code requests an hour from one address, whatever the email", async () => {
    const { code } = await mint();
    const ip = freshIp();
    const invite = await startCall("POST", "/start/invite", { body: { code }, ip });
    const cookie = cookieFrom(invite.setCookie);
    for (let i = 0; i < 6; i++) {
      const r = await startCall("POST", "/start/request-code", { cookie, ip, body: { email: `many-${i}-${run}@example.test` } });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const seventh = await startCall("POST", "/start/request-code", { cookie, ip, body: { email: `many-7-${run}@example.test` } });
    expect(seventh.status).toBe(429);
    expect(seventh.body.error).toMatch(/Too many tries/);
  });

  it("stores hashed buckets: no address or email in the clear", async () => {
    const ip = freshIp();
    await startCall("POST", "/start/invite", { body: { code: "ZZZZ-ZZZZ-ZZZZ" }, ip });
    const rows = (await localRest(`start_attempts?select=bucket&order=id.desc&limit=50`)) as Array<{ bucket: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.bucket).toMatch(/^[a-z_]+:(ip|email):[0-9a-f]{64}$/);
      expect(r.bucket).not.toContain(ip);
    }
  });

  it("a wrong sign-in code five times locks the address", async () => {
    const { code } = await mint();
    const ip = freshIp();
    const invite = await startCall("POST", "/start/invite", { body: { code }, ip });
    const cookie = cookieFrom(invite.setCookie);
    const email = `locked-${run}@example.test`;
    await plantStartCode(email, "445566");
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await startCall("POST", "/start/verify", { cookie, ip, body: { email, code: "000000" } })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    const right = await startCall("POST", "/start/verify", { cookie, ip, body: { email, code: "445566" } });
    expect(right.status).toBe(429);
  });
});

describe("creating a hub", () => {
  it("the happy path: code, sign-in, create; the creator is its admin and lands signed in", async () => {
    const { code, id } = await mint(`colleague ${run}`);
    const ip = freshIp();
    const email = `creator-${run}@example.test`;

    const invite = await startCall("POST", "/start/invite", { body: { code }, ip });
    const cookie = cookieFrom(invite.setCookie);
    expect((await startCall("GET", "/start/session", { cookie })).body).toMatchObject({ step: "sign_in", email: null });

    const sent = await startCall("POST", "/start/request-code", { cookie, ip, body: { email } });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const stored = (await localRest(`start_codes?email=eq.${encodeURIComponent(email)}&select=code_hash`)) as Array<{ code_hash: string }>;
    expect(stored[0]!.code_hash).toMatch(/^[0-9a-f]{64}$/);
    await plantStartCode(email, "778899");
    const verified = await startCall("POST", "/start/verify", { cookie, ip, body: { email: email.toUpperCase(), code: "778899" } });
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    expect((await startCall("GET", "/start/session", { cookie })).body).toMatchObject({ step: "form", email });
    expect((await startCall("GET", "/start/config", { cookie })).body.hub_domain).toBe("localhost");

    const slug = `st-${run}`;
    const res = await startCall("POST", "/start/hubs", { cookie, ip, body: hubBody(slug, { operator_name: "The Northside Group" }) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(slug);
    expect(res.body.hub).toEqual({ id: slug, name: `Start Test ${slug}`, hostname: `${slug}.localhost` });
    expect(res.body.redirect).toMatch(new RegExp(`^http://${slug}\\.localhost(:\\d+)?/#handoff=handoff_[A-Za-z0-9_-]+$`));
    // The session ends with the create.
    expect(res.setCookie).toMatch(/^civic_start=;/);
    expect((await startCall("GET", "/start/session", { cookie })).body.step).toBe("code");

    // A demo hub, with the creator as its one admin and contact.
    const config = await call("GET", "/hub-config", `${slug}.localhost`);
    expect(config.body.hub).toMatchObject({ id: slug, mode: "demo" });
    expect(config.body.settings["legal.operator_name"]).toBe("The Northside Group");
    expect(config.body.settings["legal.contact_email"]).toBe(email);
    const admins = (await localRest(`hub_settings?hub_id=eq.${slug}&key=eq.people.admin_emails&select=value`)) as Array<{ value: string }>;
    expect(JSON.parse(admins[0]!.value)).toEqual([email]);

    // The code is spent, with who and which hub.
    const row = await entitlement(id);
    expect(row).toMatchObject({ used: 1, claimed_until: null });
    const list = await consoleCall("GET", "/control/invites", { cookie: consoleCookie });
    const mine = list.body.invites.find((i: { id: string }) => i.id === id);
    expect(mine.status).toBe("used");
    expect(mine.redemptions).toEqual([expect.objectContaining({ email, hub_id: slug })]);

    // Audited, with the creator as the actor.
    const audit = await auditFor(slug);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["invite.redeem", "hub.create", "hub.sample_seed"]));
    const create = audit.find((a) => a.action === "hub.create")!;
    expect(create.actor_email).toBe(email);
    expect(create.after).toMatchObject({ via: "start", entitlement_id: id });
    expect(audit.find((a) => a.action === "invite.redeem")!.actor_email).toBe(email);

    // The handoff: swapped once for a session in which the creator is admin.
    const handoff = decodeURIComponent(res.body.redirect.split("#handoff=")[1]);
    expect((await call("GET", "/auth/me", `${slug}.localhost`, undefined, handoff)).status).toBe(401);
    const swapped = await call("POST", "/auth/handoff", `${slug}.localhost`, { handoff });
    expect(swapped.status, JSON.stringify(swapped.body)).toBe(200);
    expect(swapped.body.role).toBe("admin");
    expect(swapped.body.user.email).toBe(email);
    const me = await call("GET", "/auth/me", `${slug}.localhost`, undefined, swapped.body.token);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe("admin");
    expect((await call("POST", "/auth/handoff", `${slug}.localhost`, { handoff })).status).toBe(401);
  });

  it("a handoff works only on its own hub, and only for two minutes", async () => {
    const { code } = await mint();
    const cookie = await signedInStart(code, `hand-${run}@example.test`);
    const slug = `sth-${run}`;
    const res = await startCall("POST", "/start/hubs", { cookie, ip: freshIp(), body: hubBody(slug) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(slug);
    const handoff = decodeURIComponent(res.body.redirect.split("#handoff=")[1]);
    expect((await call("POST", "/auth/handoff", "athens.localhost", { handoff })).status).toBe(401);
    await localRest(`sessions?token=eq.${encodeURIComponent(handoff)}`, {
      method: "PATCH",
      body: JSON.stringify({ expires_at: new Date(Date.now() - 1000).toISOString() }),
    });
    expect((await call("POST", "/auth/handoff", `${slug}.localhost`, { handoff })).status).toBe(401);
    expect((await call("POST", "/auth/handoff", `${slug}.localhost`, { handoff: "sess_notahandoff" })).status).toBe(401);
  });

  it("a failed create leaves the code unused, and it still works after", async () => {
    const { code, id } = await mint();
    const ip = freshIp();
    const cookie = await signedInStart(code, `retry-${run}@example.test`, ip);

    const reserved = await startCall("POST", "/start/hubs", { cookie, ip, body: hubBody("start") });
    expect(reserved.status).toBe(400);
    expect(reserved.body.error).toContain("reserved");

    const taken = await startCall("POST", "/start/hubs", { cookie, ip, body: hubBody("athens") });
    expect(taken.status).toBe(409);

    const noPlace = await startCall("POST", "/start/hubs", { cookie, ip, body: hubBody(`stp-${run}`, { hub_kind: "place" }) });
    expect(noPlace.status).toBe(400);

    expect(await entitlement(id)).toMatchObject({ used: 0, claimed_until: null });
    expect((await inviteAudit(id)).map((a) => a.action)).toEqual(["invite.mint"]);

    const slug = `str-${run}`;
    const ok = await startCall("POST", "/start/hubs", { cookie, ip, body: hubBody(slug) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    created.push(slug);
    expect((await entitlement(id)).used).toBe(1);
  });

  it("takes no mode, address or admin from the form", async () => {
    const { code } = await mint();
    const email = `fixed-${run}@example.test`;
    const cookie = await signedInStart(code, email);
    const slug = `stf-${run}`;
    const res = await startCall("POST", "/start/hubs", {
      cookie,
      ip: freshIp(),
      body: hubBody(slug, { mode: "live", hostname: "evil.example.com", admin_email: "someone-else@example.test" }),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(slug);
    expect(res.body.hub.hostname).toBe(`${slug}.localhost`);
    const config = await call("GET", "/hub-config", `${slug}.localhost`);
    expect(config.body.hub.mode).toBe("demo");
    const admins = (await localRest(`hub_settings?hub_id=eq.${slug}&key=eq.people.admin_emails&select=value`)) as Array<{ value: string }>;
    expect(JSON.parse(admins[0]!.value)).toEqual([email]);
  });

  it("one code makes one hub, even when two creates race", async () => {
    const { code, id } = await mint();
    const ip = freshIp();
    const cookie = await signedInStart(code, `race-${run}@example.test`, ip);
    const [a, b] = await Promise.all([
      startCall("POST", "/start/hubs", { cookie, ip, body: hubBody(`sta-${run}`) }),
      startCall("POST", "/start/hubs", { cookie, ip, body: hubBody(`stb-${run}`) }),
    ]);
    const statuses = [a.status, b.status].sort();
    for (const r of [a, b]) if (r.status === 201) created.push(r.body.hub.id);
    expect(statuses).toEqual([201, 403]);
    expect([a, b].find((r) => r.status === 403)!.body.error).toBe(REFUSED);
    expect((await entitlement(id)).used).toBe(1);
  });

  it("a code revoked after sign-in can no longer create, and the page says so", async () => {
    const { code, id } = await mint();
    const cookie = await signedInStart(code, `revoked-${run}@example.test`);
    await consoleCall("POST", `/control/invites/${id}/revoke`, { cookie: consoleCookie });
    const res = await startCall("POST", "/start/hubs", { cookie, ip: freshIp(), body: hubBody(`stv-${run}`) });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe(REFUSED);
    expect((await startCall("GET", "/start/session", { cookie })).body).toMatchObject({ step: "code", code_refused: true });
  });

  it("one person may redeem a second code for a second hub (Adam, 2026-10-08)", async () => {
    const email = `twice-${run}@example.test`;
    for (const suffix of ["1", "2"]) {
      const { code } = await mint();
      const cookie = await signedInStart(code, email);
      const slug = `st2${suffix}-${run}`;
      const res = await startCall("POST", "/start/hubs", { cookie, ip: freshIp(), body: hubBody(slug) });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      created.push(slug);
    }
  });

  it("needs a sign-in before the form", async () => {
    const { code } = await mint();
    const invite = await startCall("POST", "/start/invite", { body: { code }, ip: freshIp() });
    const cookie = cookieFrom(invite.setCookie);
    const res = await startCall("POST", "/start/hubs", { cookie, ip: freshIp(), body: hubBody(`stn-${run}`) });
    expect(res.status).toBe(401);
  });
});
