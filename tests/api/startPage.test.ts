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

import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { CURRENT_LEGAL_VERSION } from "../../src/shared/legal.js";
import { localRest, localStack } from "../fixtures/adminSession.js";
import { OPERATOR, auditFor, consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";
import { START_HOST, cookieFrom, freshIp, plantInviteLink, plantStartCode, signedInStart, startCall } from "../fixtures/startCall.js";

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

  it("emails an unused code to an address, and audits who it went to", async () => {
    const { code, id } = await mint();
    const cookie = await mintConsoleSession();
    const res = await consoleCall("POST", `/control/invites/${id}/send`, { cookie, body: { code, email: " Sam@Example.test " } });
    expect(res.status).toBe(200);
    expect(res.body.sent_to).toBe("sam@example.test");
    const sent = (await inviteAudit(id)).filter((a) => a.action === "invite.send");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ actor_email: OPERATOR });
    expect(sent[0]!.after).toEqual({ entitlement_id: id, code_hint: code.slice(-4), sent_to: "sam@example.test" });
    expect(JSON.stringify(sent[0])).not.toContain(code);
    // Sending spends nothing.
    expect((await entitlement(id))!.used).toBe(0);
  });

  it("refuses a bad address, another invite's code, and a revoked code", async () => {
    const one = await mint();
    const other = await mint();
    const cookie = await mintConsoleSession();
    const send = (id: string, code: string, email = "sam@example.test") =>
      consoleCall("POST", `/control/invites/${id}/send`, { cookie, body: { code, email } });
    expect((await send(one.id, one.code, "two@a.test, b@a.test")).status).toBe(400);
    expect((await send(one.id, other.code)).status).toBe(403);
    expect((await consoleCall("POST", `/control/invites/${other.id}/revoke`, { cookie })).status).toBe(200);
    expect((await send(other.id, other.code)).status).toBe(403);
    expect((await inviteAudit(one.id)).map((a) => a.action)).toEqual(["invite.mint"]);
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

describe("an invite the console emailed", () => {
  const DAY = 86_400_000;

  async function refused(token: unknown, ip: string) {
    const res = await startCall("POST", "/start/invite-link", { body: { token }, ip });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.setCookie).toBeUndefined();
    return res.body as { error: string; link_state: string; email: string | null; hub_url: string | null };
  }

  it("sending records a link for that address, by hash, for seven days within the invite's end", async () => {
    const { code, id } = await mint(`seven-${run}`, 30);
    const email = `linked-${run}@example.test`;
    const sent = await consoleCall("POST", `/control/invites/${id}/send`, { cookie: consoleCookie, body: { email, code } });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const rows = (await localRest(`entitlement_links?entitlement_id=eq.${id}&select=*`)) as Array<Record<string, string | boolean | null>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe(email);
    expect(rows[0]!.spent_at).toBeNull();
    expect(rows[0]!.refreshed).toBe(false);
    const lasts = Date.parse(rows[0]!.expires_at as string) - Date.parse(rows[0]!.created_at as string);
    expect(Math.abs(lasts - 7 * DAY)).toBeLessThan(60_000);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);

    // An invite ending sooner than seven days: the link ends with it.
    const short = await mint(`short-${run}`, 2);
    await consoleCall("POST", `/control/invites/${short.id}/send`, { cookie: consoleCookie, body: { email, code: short.code } });
    const [link] = (await localRest(`entitlement_links?entitlement_id=eq.${short.id}&select=expires_at`)) as Array<{ expires_at: string }>;
    const invite = (await entitlement(short.id)) as unknown as { expires_at: string };
    expect(Date.parse(link!.expires_at)).toBe(Date.parse(invite.expires_at));
  });

  it("following the link signs in as that address with no code, and makes the hub", async () => {
    const { id } = await mint();
    const email = `follower-${run}@example.test`;
    const token = `link-${run}-a`;
    await plantInviteLink(id, email, token);
    const ip = freshIp();
    const followed = await startCall("POST", "/start/invite-link", { body: { token }, ip });
    expect(followed.status, JSON.stringify(followed.body)).toBe(200);
    expect(followed.body).toEqual({ step: "form", email });
    const cookie = cookieFrom(followed.setCookie);
    const view = await startCall("GET", "/start/session", { cookie, ip });
    expect(view.body.step).toBe("form");
    expect(view.body.email).toBe(email);

    const slug = `link-${run}`.slice(0, 30);
    const made = await startCall("POST", "/start/hubs", { cookie, ip, body: hubBody(slug) });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    created.push(made.body.hub.id);
    // The handoff into the hub is an ordinary admin session: the proof is the mailbox's, as an emailed code's is.
    const handoff = decodeURIComponent(/#handoff=(.+)$/.exec(made.body.redirect)![1]!);
    const swapped = await call("POST", "/auth/handoff", `${slug}.localhost`, { handoff });
    expect(swapped.status, JSON.stringify(swapped.body)).toBe(200);
    expect(swapped.body.user.email).toBe(email);
    const audit = await inviteAudit(id);
    expect(audit.map((a) => a.action)).toContain("invite.link_follow");

    // The same link again: the invite made its hub, so it points to the hub's sign-in.
    const after = await refused(token, ip);
    expect(after.link_state).toBe("redeemed");
    expect(after.error).toMatch(/already been used to create a hub/);
    expect(after.hub_url).toMatch(new RegExp(`^https?://${slug}\\.localhost(:\\d+)?/sign-in$`));
    // And it offers no fresh link.
    const fresh = await startCall("POST", "/start/invite-link/refresh", { body: { token }, ip });
    expect(fresh.status).toBe(403);
  });

  it("works once; a later click says so and offers a fresh link to the same address", async () => {
    const { id } = await mint();
    const token = `link-${run}-b`;
    const email = `once-${run}@example.test`;
    await plantInviteLink(id, email, token);
    const ip = freshIp();
    expect((await startCall("POST", "/start/invite-link", { body: { token }, ip })).status).toBe(200);
    const again = await refused(token, ip);
    expect(again).toEqual({
      error: `This link has already been used. Your invite is still good, so we can email a fresh link to ${email}.`,
      link_state: "spent",
      email,
      hub_url: null,
    });
  });

  it("two followers at once: one gets the session", async () => {
    const { id } = await mint();
    const token = `link-${run}-race`;
    await plantInviteLink(id, `race-${run}@example.test`, token);
    const ip = freshIp();
    const both = await Promise.all([1, 2].map(() => startCall("POST", "/start/invite-link", { body: { token }, ip })));
    expect(both.map((r) => r.status).sort()).toEqual([200, 403]);
  });

  it("an unknown, expired, revoked or ended link each says what happened; a refused follow does not spend it", async () => {
    const ip = freshIp();
    for (const token of ["nope", "", 42]) {
      const body = await refused(token, ip);
      expect(body.link_state).toBe("unknown");
      expect(body.error).toMatch(/contact@civic\.social/);
    }
    const old = await mint();
    await plantInviteLink(old.id, `old-${run}@example.test`, `link-${run}-old`, new Date(Date.now() - 1000).toISOString());
    expect((await refused(`link-${run}-old`, ip)).link_state).toBe("expired");

    const revoked = await mint();
    await plantInviteLink(revoked.id, `rev-${run}@example.test`, `link-${run}-rev`);
    await consoleCall("POST", `/control/invites/${revoked.id}/revoke`, { cookie: consoleCookie, body: {} });
    const ended = await refused(`link-${run}-rev`, ip);
    expect(ended.link_state).toBe("ended");
    expect(ended.error).toBe("This invite has ended. To ask for a new one, write to contact@civic.social.");
    const rows = (await localRest(`entitlement_links?entitlement_id=eq.${revoked.id}&select=spent_at`)) as Array<{ spent_at: string | null }>;
    expect(rows[0]!.spent_at).toBeNull();

    const lapsed = await mint();
    await plantInviteLink(lapsed.id, `lapsed-${run}@example.test`, `link-${run}-lapsed`);
    await localRest(`entitlements?id=eq.${lapsed.id}`, { method: "PATCH", body: JSON.stringify({ expires_at: new Date(Date.now() - 1000).toISOString() }) });
    expect((await refused(`link-${run}-lapsed`, ip)).link_state).toBe("ended");
    const noFresh = await startCall("POST", "/start/invite-link/refresh", { body: { token: `link-${run}-lapsed` }, ip });
    expect(noFresh.status).toBe(403);
    expect(noFresh.body.error).toMatch(/This invite has ended/);
  });

  it("a fresh link for a link that still works is refused", async () => {
    const { id } = await mint();
    await plantInviteLink(id, `good-${run}@example.test`, `link-${run}-good`);
    const res = await startCall("POST", "/start/invite-link/refresh", { body: { token: `link-${run}-good` }, ip: freshIp() });
    expect(res.status).toBe(409);
  });

  it("fresh links are limited per invite: one a minute, three a day", async () => {
    const { id } = await mint();
    const email = `limited-${run}@example.test`;
    const token = `link-${run}-limit`;
    await plantInviteLink(id, email, token, new Date(Date.now() - 1000).toISOString());
    const ask = () => startCall("POST", "/start/invite-link/refresh", { body: { token }, ip: freshIp() });
    const first = await ask();
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toEqual({ sent_to: email });
    const soon = await ask();
    expect(soon.status).toBe(429);
    expect(soon.body.error).toMatch(/ask again in a minute/);

    // Two minutes on, twice more; then the day's three are used.
    const age = async () =>
      localRest(`entitlement_links?entitlement_id=eq.${id}&refreshed=eq.true`, {
        method: "PATCH",
        body: JSON.stringify({ created_at: new Date(Date.now() - 2 * 60_000).toISOString() }),
      });
    await age();
    expect((await ask()).status).toBe(200);
    await age();
    expect((await ask()).status).toBe(200);
    await age();
    const fourth = await ask();
    expect(fourth.status).toBe(429);
    expect(fourth.body.error).toMatch(/Three fresh links have been sent today.*contact@civic\.social/);

    // Every fresh link went to the same address, and the console's own send never counts.
    const rows = (await localRest(`entitlement_links?entitlement_id=eq.${id}&select=email,refreshed`)) as Array<{ email: string; refreshed: boolean }>;
    expect(rows.filter((r) => r.refreshed)).toHaveLength(3);
    expect(new Set(rows.map((r) => r.email))).toEqual(new Set([email]));
    expect((await inviteAudit(id)).filter((a) => a.action === "invite.link_refresh")).toHaveLength(3);
  });

  // The fresh link's token exists only in the email, so this one runs the
  // send in-process with the fake mail transport and follows what it sent.
  for (const how of ["spent", "expired"] as const) {
    it(`${how} → a fresh link → it signs in`, async () => {
      const { id } = await mint();
      const email = `fresh-${how}-${run}@example.test`;
      const token = `link-${run}-fresh-${how}`;
      const ip = freshIp();
      if (how === "spent") {
        await plantInviteLink(id, email, token);
        expect((await startCall("POST", "/start/invite-link", { body: { token }, ip })).status).toBe(200);
      } else {
        await plantInviteLink(id, email, token, new Date(Date.now() - 1000).toISOString());
      }
      expect((await refused(token, ip)).link_state).toBe(how);

      const { url, key } = localStack();
      process.env.SUPABASE_URL = url;
      process.env.SUPABASE_SERVICE_ROLE_KEY = key;
      const { installAdapters } = await import("../../src/adapters/index.js");
      const { fakeMail } = await import("../../src/adapters/fakes/mail.js");
      const { sendFreshInviteLink } = await import("../../src/control/inviteRefresh.js");
      const mail = fakeMail({ configured: true });
      installAdapters({ mail });
      try {
        expect(await sendFreshInviteLink(token, START_HOST)).toEqual({ sent_to: email, entitlement_id: id });
      } finally {
        installAdapters({ mail: fakeMail() });
      }
      expect(mail.outbox.map((m) => m.to)).toEqual([email]);
      const text = mail.outbox[0]!.text ?? "";
      expect(text).not.toMatch(/code/i);
      const fresh = /#invite=([A-Za-z0-9_-]+)/.exec(text)![1]!;
      expect(fresh).not.toBe(token);

      const followed = await startCall("POST", "/start/invite-link", { body: { token: fresh }, ip });
      expect(followed.status, JSON.stringify(followed.body)).toBe(200);
      expect(followed.body).toEqual({ step: "form", email });
    });
  }

  it("needs the start page's header, as every write does", async () => {
    for (const path of ["/start/invite-link", "/start/invite-link/refresh"]) {
      expect((await startCall("POST", path, { body: { token: "x" }, csrf: false })).status).toBe(403);
    }
  });

  it("is on the start page only", async () => {
    for (const path of ["/start/invite-link", "/start/invite-link/refresh"]) {
      expect((await startCall("POST", path, { body: { token: "x" }, host: "athens.localhost" })).status).toBe(404);
    }
  });
});

describe("the web address, checked as it is typed", () => {
  it("says free, taken with a state-qualified suggestion, or reserved; only when signed in", async () => {
    const { code } = await mint();
    const ip = freshIp();
    expect((await startCall("GET", "/start/slug-check?slug=athens", { ip })).status).toBe(401);
    const cookie = await signedInStart(code, `slugs-${run}@example.test`, ip);
    const free = await startCall("GET", `/start/slug-check?slug=free-${run}`, { cookie, ip });
    expect(free.body).toEqual({ available: true, reason: null, suggestion: null });
    const taken = await startCall("GET", "/start/slug-check?slug=athens&state=co", { cookie, ip });
    expect(taken.body).toEqual({ available: false, reason: "taken", suggestion: "athens-co" });
    const noState = await startCall("GET", "/start/slug-check?slug=athens", { cookie, ip });
    expect(noState.body.reason).toBe("taken");
    expect(noState.body.suggestion).toBe("athens-2");
    expect((await startCall("GET", "/start/slug-check?slug=www", { cookie, ip })).body.reason).toBe("reserved");
    expect((await startCall("GET", "/start/slug-check?slug=-", { cookie, ip })).body).toMatchObject({ reason: "invalid", suggestion: null });
  });

  it("the suggestion goes to the state's form when the clean name is taken", async () => {
    const { code } = await mint();
    const ip = freshIp();
    const cookie = await signedInStart(code, `sug-${run}@example.test`, ip);
    const res = await startCall("GET", "/start/slug-suggestion?name=Athens&type=county&state=co", { cookie, ip });
    expect(res.body.slug).toBe("athens-co");
    expect(res.body.passed_over[0]).toMatchObject({ slug: "athens", reason: "taken" });
  });
});

describe("a hub made with Operated by left empty", () => {
  it("stores no operator, and its documents read its administrators", async () => {
    const { code } = await mint();
    const ip = freshIp();
    const cookie = await signedInStart(code, `noop-${run}@example.test`, ip);
    const slug = `noop-${run}`.slice(0, 30);
    const res = await startCall("POST", "/start/hubs", { cookie, ip, body: hubBody(slug) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(res.body.hub.id);
    const rows = (await localRest(`hub_settings?hub_id=eq.${slug}&key=eq.legal.operator_name&select=value`)) as unknown[];
    expect(rows).toHaveLength(0);
    const docs = await call("GET", "/hub-config/documents", `${slug}.localhost`);
    expect(docs.status).toBe(200);
    const terms: string = docs.body.documents["legal.terms"];
    expect(terms).toContain("is operated by its administrators");
    expect(terms).toContain("the Hub's administrators and its contributors");
    expect(terms).not.toMatch(/\{[A-Z_]+\}/);
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

  it("one email a minute to an address, from anywhere, with the time to ask again", async () => {
    const { code } = await mint();
    const invite = await startCall("POST", "/start/invite", { body: { code }, ip: freshIp() });
    const cookie = cookieFrom(invite.setCookie);
    const email = `limited-${run}@example.test`;
    expect((await startCall("POST", "/start/request-code", { cookie, ip: freshIp(), body: { email } })).status).toBe(200);
    const second = await startCall("POST", "/start/request-code", { cookie, ip: freshIp(), body: { email, tz: "America/Chicago" } });
    expect(second.status).toBe(429);
    expect(second.body.code).toBe("code_throttled");
    expect(second.body.error).toMatch(/^We just sent you a code\. You can ask for another after \d{1,2}:\d\d [AP]M\.$/);
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
    expect(seventh.body.error).toMatch(/^Too many attempts\. Try again after /);
  });

  it("stores hashed buckets: no address or email in the clear", async () => {
    const ip = freshIp();
    await startCall("POST", "/start/invite", { body: { code: "ZZZZ-ZZZZ-ZZZZ" }, ip });
    const rows = (await localRest(`rate_limit_hits?select=bucket&bucket=like.start.*&order=at.desc&limit=50`)) as Array<{ bucket: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.bucket).toMatch(/^start\.[a-z_]+:(ip|email|ip_email):[0-9a-f]{64}$/);
      expect(r.bucket).not.toContain(ip);
    }
  });

  it("a wrong sign-in code five times burns the code, not the address", async () => {
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
    expect(statuses).toEqual([400, 400, 400, 400, 400]);
    const right = await startCall("POST", "/start/verify", { cookie, ip: freshIp(), body: { email, code: "445566" } });
    expect(right.body.code).toBe("no_live_code");
    // A fresh code works, from another network.
    await plantStartCode(email, "445567");
    expect((await startCall("POST", "/start/verify", { cookie, ip: freshIp(), body: { email, code: "445567" } })).status).toBe(200);
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
    const stored = (await localRest(`platform_sign_in_codes?realm=eq.start&email=eq.${encodeURIComponent(email)}&select=code_hash`)) as Array<{ code_hash: string }>;
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
    expect(create.after).toMatchObject({ via: "start", entitlement_id: id, terms_version: CURRENT_LEGAL_VERSION });
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
    // Pressing Create beside the notice was the creator's agreement: they
    // aren't asked again as a member (sign-in slice).
    expect(me.body.user.tos_version_accepted).toBe(CURRENT_LEGAL_VERSION);
    expect((await call("POST", "/auth/handoff", `${slug}.localhost`, { handoff })).status).toBe(401);
  });

  it("serves the plain-language summaries of what Create agrees to, for the place being made", async () => {
    const { code } = await mint();
    const cookie = await signedInStart(code, `legal-${run}@example.test`);
    const res = await startCall("GET", "/start/legal?kind=place&place=Exampleville", { cookie });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(CURRENT_LEGAL_VERSION);
    expect(res.body.summaries.map((s: { title: string }) => s.title)).toEqual(["Code of Conduct", "Privacy Notice", "Terms"]);
    const terms = res.body.summaries[2].summary as string;
    expect(terms).toContain("Join only if you live in Exampleville.");
    for (const s of res.body.summaries) expect(s.summary).not.toMatch(/\{[A-Z_]+\}|\{\{/);
    // Signed out, nothing.
    expect((await startCall("GET", "/start/legal")).status).toBe(401);
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
    // Stored as its SHA-256 since Audit 2.
    const handoffHash = createHash("sha256").update(handoff).digest("hex");
    await localRest(`sessions?token=eq.${handoffHash}`, {
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

describe("a neighbourhood or association hub from the start page", () => {
  it("needs no jurisdiction, takes a typed name, and starts with its own samples", async () => {
    const { code } = await mint();
    const cookie = await signedInStart(code, `assoc-${run}@example.test`);
    const slug = `st-assoc-${run}`;
    const res = await startCall("POST", "/start/hubs", {
      cookie,
      ip: freshIp(),
      body: hubBody(slug, { hub_kind: "community", jurisdiction_custom: true, jurisdiction_name: "Example Homeowners" }),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(slug);
    const config = await call("GET", "/hub-config", `${slug}.localhost`);
    expect(config.body.settings["identity.hub_kind"]).toBe("community");
    expect(config.body.hub.jurisdiction_name).toBe("Example Homeowners");
    expect(res.body.sample_content.error).toBeUndefined();
    const titles = (await localRest(`processes?hub_id=eq.${slug}&select=title`)) as Array<{ title: string }>;
    expect(titles.map((t) => t.title)).toContain("What should we do first with this year's shared funds?");
  });

  it("has a location from the list, optional as for any other kind", async () => {
    const { code } = await mint();
    const cookie = await signedInStart(code, `assoc2-${run}@example.test`);
    const slug = `st-assoc2-${run}`;
    const res = await startCall("POST", "/start/hubs", {
      cookie,
      ip: freshIp(),
      body: hubBody(slug, { hub_kind: "community", jurisdiction_ocd_id: "ocd-division/country:us/state:va" }),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(slug);
    const config = await call("GET", "/hub-config", `${slug}.localhost`);
    expect(config.body.hub.jurisdiction_name).toBe("Virginia");
  });

  it("refuses a typed place on a jurisdiction's hub", async () => {
    const { code } = await mint();
    const cookie = await signedInStart(code, `juris-${run}@example.test`);
    const res = await startCall("POST", "/start/hubs", {
      cookie,
      ip: freshIp(),
      body: hubBody(`st-juris-${run}`, { hub_kind: "place", jurisdiction_custom: true, jurisdiction_name: "Somewhere" }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/from the list/);
  });
});
