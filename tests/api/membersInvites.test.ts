// Members and invites (2026-10-14): "N members" and the avatar stack, the
// Members page, hiding oneself, and "Share this hub"'s email invites.
//
// Privacy rules under test (Adam's design, 2026-10-10):
//   - a hidden member is absent from the Members page and the stack, but
//     counted, and admins see them in Settings → People;
//   - no answer here carries an email address;
//   - the daily invite limit (10 for a member);
//   - no address is invited twice, and an address that already has an account
//     is never invited, and neither is told apart from a sent invite;
//   - the admin log records the addresses, never the message.
//
// Hubs made by the console (console.localhost, CI's env), archived in afterAll.

import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";

const run = Date.now().toString(36);
const LIVE = `mil-${run}`;
const BETA = `mib-${run}`;
const DEMO = `mid-${run}`;
const host = (slug: string) => `${slug}.localhost`;
const ADMIN = `members-admin-${run}@example.test`;
const created: string[] = [];
let cookie = "";

type Row = Record<string, any>;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const seed = (hub: string, userId: string) => sha256(`civic-avatar:${hub}:${userId}`).slice(0, 16);
const addr = (label: string) => `${label}-${run}@example.test`;

async function createHub(slug: string, body: Row): Promise<void> {
  const res = await consoleCall("POST", "/control/hubs", {
    cookie,
    body: {
      slug,
      hostname: host(slug),
      admin_email: ADMIN,
      name: `Members ${slug} Civic Hub`,
      jurisdiction_name: "Example County, Ohio",
      jurisdiction_custom: true,
      jurisdiction_type: "county",
      ...body,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.push(slug);
  // A new hub shows its members from 10 (the Members plugin, 2026-10-14);
  // these tests count a handful, so they show them from the first.
  const admin = await mintSession(slug, ADMIN);
  const set = await call("PUT", "/admin/hub/settings", host(slug), { section: "plugins", values: { "plugin.members.min_count": "0" } }, admin);
  expect(set.status, JSON.stringify(set.body)).toBe(200);
}

/** A joined member with a name of this test's choosing; returns token and id. */
async function member(hub: string, label: string, name: string): Promise<{ token: string; id: string }> {
  const email = addr(label);
  const token = await mintSession(hub, email);
  const rows = (await localRest(`users?select=id&hub_id=eq.${hub}&email=eq.${encodeURIComponent(email)}`)) as Row[];
  const id = rows[0]!.id as string;
  await localRest(`users?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ full_name: name }) });
  return { token, id };
}

function noAddresses(body: unknown): void {
  expect(JSON.stringify(body)).not.toMatch(/@example\.test/);
}

beforeAll(async () => {
  cookie = await mintConsoleSession();
  await createHub(LIVE, { mode: "live" });
  await createHub(BETA, { mode: "beta" });
  await createHub(DEMO, { sample_content: true });
});

afterAll(async () => {
  for (const id of created) {
    const code = String(100000 + Math.floor(Math.random() * 899999));
    await plantCode("step_up", code);
    const res = await consoleCall("POST", `/control/hubs/${id}/archive`, { cookie, body: { step_up_code: code } });
    if (res.status !== 200 && !/already archived/.test(res.body.error ?? "")) {
      throw new Error(`could not archive ${id}: ${JSON.stringify(res.body)}`);
    }
  }
});

describe("members: the count, the stack and the page", () => {
  let shown: { token: string; id: string };
  let hidden: { token: string; id: string };

  beforeAll(async () => {
    shown = await member(LIVE, "shown", "Avery Shown");
    hidden = await member(LIVE, "hidden", "Blake Hidden");
    const res = await call("PATCH", "/auth/me", host(LIVE), { hidden_from_members: true }, hidden.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.user.hidden_from_members).toBe(true);
  });

  it("the home page's count includes a hidden member, and its stack leaves them out", async () => {
    const res = await call("GET", "/members/summary", host(LIVE));
    expect(res.status).toBe(200);
    const users = (await localRest(`users?select=id&hub_id=eq.${LIVE}&is_resident=eq.true&is_sample=eq.false`)) as Row[];
    expect(res.body.count).toBe(users.length);
    expect(res.body.stack).toContain(seed(LIVE, shown.id));
    expect(res.body.stack).not.toContain(seed(LIVE, hidden.id));
    for (const s of res.body.stack) expect(s).toMatch(/^[0-9a-f]{16}$/);
    noAddresses(res.body);
  });

  it("the Members page is for signed-in members only", async () => {
    expect((await call("GET", "/members", host(LIVE))).status).toBe(401);
  });

  it("the Members page leaves a hidden member out, names the rest, marks admins and shows no address", async () => {
    const admin = await mintSession(LIVE, ADMIN);
    expect(admin).toBeTruthy();
    const res = await call("GET", "/members", host(LIVE), undefined, shown.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const names = res.body.members.map((m: Row) => m.name);
    expect(names).toContain("Avery Shown");
    expect(names).not.toContain("Blake Hidden");
    expect(res.body.members.map((m: Row) => m.avatar)).not.toContain(seed(LIVE, hidden.id));
    expect(res.body.members.find((m: Row) => m.name === "Avery Shown").is_admin).toBe(false);
    expect(res.body.members.some((m: Row) => m.is_admin)).toBe(true);
    expect(res.body.count).toBeGreaterThan(res.body.members.length);
    expect(res.body.you_are_hidden).toBe(false);
    noAddresses(res.body);
    for (const m of res.body.members) expect(Object.keys(m).sort()).toEqual(["avatar", "is_admin", "name"]);
  });

  it("a hidden member is told so on the page", async () => {
    const res = await call("GET", "/members", host(LIVE), undefined, hidden.token);
    expect(res.body.you_are_hidden).toBe(true);
  });

  it("admins see the hidden member in Settings → People, without an address; members can't", async () => {
    const admin = await mintSession(LIVE, ADMIN);
    const res = await call("GET", "/admin/hub/members", host(LIVE), undefined, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.hidden.map((m: Row) => m.name)).toEqual(["Blake Hidden"]);
    noAddresses(res.body);
    expect((await call("GET", "/admin/hub/members", host(LIVE), undefined, shown.token)).status).toBe(403);
  });

  it("showing oneself again puts them back", async () => {
    await call("PATCH", "/auth/me", host(LIVE), { hidden_from_members: false }, hidden.token);
    const res = await call("GET", "/members/summary", host(LIVE));
    expect(res.body.stack).toContain(seed(LIVE, hidden.id));
    await call("PATCH", "/auth/me", host(LIVE), { hidden_from_members: true }, hidden.token);
  });

  it("refuses a hide switch that isn't true or false", async () => {
    const res = await call("PATCH", "/auth/me", host(LIVE), { hidden_from_members: "yes" }, shown.token);
    expect(res.status).toBe(400);
  });

  it("a demo hub counts its sample members; a beta hub never does", async () => {
    const demo = await call("GET", "/members/summary", host(DEMO));
    const samples = (await localRest(`users?select=id&hub_id=eq.${DEMO}&is_sample=eq.true&is_resident=eq.true`)) as Row[];
    expect(samples.length).toBeGreaterThan(0);
    expect(demo.body.count).toBeGreaterThanOrEqual(samples.length);
    expect(demo.body.stack.length).toBeGreaterThan(0);

    // A sample account planted on the beta hub is not a member there.
    const id = `user_sample_${BETA}_900`;
    await localRest("users", {
      method: "POST",
      body: JSON.stringify({ id, hub_id: BETA, email: addr("beta-sample"), email_verified: true, is_resident: true, is_sample: true, full_name: "Sample Person" }),
    });
    const beta = await call("GET", "/members/summary", host(BETA));
    expect(beta.body.stack).not.toContain(seed(BETA, id));
    const real = (await localRest(`users?select=id&hub_id=eq.${BETA}&is_resident=eq.true&is_sample=eq.false`)) as Row[];
    expect(beta.body.count).toBe(real.length);
  });
});

describe("Share this hub: email invites", () => {
  const invites = async (hub: string, email: string) =>
    (await localRest(`hub_invites?select=outcome,invited_by,link_hash,expires_at,used_at&hub_id=eq.${hub}&email=eq.${encodeURIComponent(email)}`)) as Row[];

  it("emails each new address once, with a 14-day link, and records it without the message", async () => {
    const a = await member(LIVE, "inviter-a", "Casey Inviter");
    const marker = `secret-message-${run}`;
    const to = [addr("friend-1"), addr("friend-2")];
    const res = await call("POST", "/members/invites", host(LIVE), { emails: `${to[0]}, ${to[1]}\n${to[0]}`, message: `Come along! ${marker}` }, a.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ outcome: "emailed", done: 2, over_limit: [], failed: 0, limit: 10 });
    const rows = await invites(LIVE, to[0]!);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "emailed", invited_by: a.id, used_at: null });
    expect(rows[0]!.link_hash).toMatch(/^[0-9a-f]{64}$/);
    const days = (Date.parse(rows[0]!.expires_at) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);

    const log = (await localRest(`hub_admin_audit_log?select=actor_email,action,after&hub_id=eq.${LIVE}&action=eq.member.invite`)) as Row[];
    const mine = log.find((r) => r.actor_email === addr("inviter-a"));
    expect(mine?.after.invited.sort()).toEqual([...to].sort());
    expect(JSON.stringify(log)).not.toContain(marker);
    expect(JSON.stringify(await localRest(`hub_invites?hub_id=eq.${LIVE}`))).not.toContain(marker);
  });

  it("never invites an address twice, or one that has an account, and says so the same way", async () => {
    const a = await member(LIVE, "inviter-b", "Drew Inviter");
    const c = await member(LIVE, "inviter-c", "Emery Inviter");
    const once = addr("once");
    expect((await call("POST", "/members/invites", host(LIVE), { emails: once }, a.token)).body.done).toBe(1);
    const again = await call("POST", "/members/invites", host(LIVE), { emails: [once, addr("inviter-a")] }, c.token);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ outcome: "emailed", done: 2, over_limit: [] });
    const rows = await invites(LIVE, once);
    expect(rows.filter((r) => r.outcome === "emailed")).toHaveLength(1);
    expect(rows.filter((r) => r.outcome === "skipped")).toHaveLength(1);
    // An existing member's address: skipped, never emailed.
    expect((await invites(LIVE, addr("inviter-a"))).map((r) => r.outcome)).toEqual(["skipped"]);
  });

  it("stops at the daily limit, and every address counts toward it", async () => {
    const a = await member(LIVE, "limit", "Finley Limit");
    const first = Array.from({ length: 4 }, (_, i) => addr(`limit-${i}`));
    // One already-invited address in the first batch still counts.
    const res1 = await call("POST", "/members/invites", host(LIVE), { emails: [...first, addr("once")] }, a.token);
    expect(res1.body.done).toBe(5);
    const rest = Array.from({ length: 7 }, (_, i) => addr(`limit-more-${i}`));
    const res2 = await call("POST", "/members/invites", host(LIVE), { emails: rest }, a.token);
    expect(res2.body.done).toBe(5);
    expect(res2.body.over_limit).toEqual(rest.slice(5));
    expect(await invites(LIVE, rest[6]!)).toEqual([]);
    const res3 = await call("POST", "/members/invites", host(LIVE), { emails: addr("limit-late") }, a.token);
    expect(res3.body).toMatchObject({ done: 0, over_limit: [addr("limit-late")] });
  });

  it("refuses an address that isn't one, and sends nothing", async () => {
    const a = await member(LIVE, "typo", "Gray Typo");
    const res = await call("POST", "/members/invites", host(LIVE), { emails: `${addr("fine")}, not-an-address` }, a.token);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invite_bad_address");
    expect(await invites(LIVE, addr("fine"))).toEqual([]);
  });

  it("is for signed-in members only", async () => {
    expect((await call("POST", "/members/invites", host(LIVE), { emails: addr("x") })).status).toBe(401);
  });

  it("on a beta hub, a member's invite goes on the waitlist marked with who invited, and sends no email", async () => {
    const m = await member(BETA, "beta-member", "Harper Beta");
    const to = addr("beta-friend");
    const res = await call("POST", "/members/invites", host(BETA), { emails: to }, m.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ outcome: "waitlisted", done: 1 });
    expect(await invites(BETA, to)).toMatchObject([{ outcome: "waitlisted", link_hash: null, expires_at: null }]);
    const wait = (await localRest(`waitlist?select=email,invited_by&hub_id=eq.${BETA}&email=eq.${encodeURIComponent(to)}`)) as Row[];
    expect(wait).toEqual([{ email: to, invited_by: m.id }]);

    const admin = await mintSession(BETA, ADMIN);
    const settings = await call("GET", "/admin/settings", host(BETA), undefined, admin);
    const entry = settings.body.waitlist?.find((w: Row) => w.email === to);
    expect(entry?.invited_by_name).toBe("Harper Beta");
  });

  it("on a beta hub, an admin's invite lets the address in and is emailed", async () => {
    const admin = await mintSession(BETA, ADMIN);
    const to = addr("beta-admin-friend");
    const res = await call("POST", "/members/invites", host(BETA), { emails: to }, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ outcome: "emailed", done: 1, limit: 50 });
    const allow = (await localRest(`hub_settings?select=value&hub_id=eq.${BETA}&key=eq.beta.allowlist`)) as Row[];
    expect(allow[0]?.value).toContain(to);
  });

  it("a demo hub sends no invites by email", async () => {
    const m = await member(DEMO, "demo-member", "Indy Demo");
    const res = await call("POST", "/members/invites", host(DEMO), { emails: addr("demo-friend") }, m.token);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("invite_demo_hub");
  });
});

describe("the invite link", () => {
  const plant = async (hub: string, email: string, token: string, expiresInMs = 14 * 86_400_000) => {
    await localRest("hub_invites", {
      method: "POST",
      body: JSON.stringify({ hub_id: hub, email, outcome: "emailed", link_hash: sha256(token), expires_at: new Date(Date.now() + expiresInMs).toISOString() }),
    });
  };
  const token = (n: number) => `invite-${run}-${n}-${"y".repeat(32)}`;

  it("signs the new neighbour in once, as a code session, ready to join", async () => {
    const email = addr("link-new");
    await plant(LIVE, email, token(1));
    const res = await call("POST", "/auth/verify-invite", host(LIVE), { token: token(1) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.user).toMatchObject({ email, is_resident: false });
    const sessions = (await localRest(`sessions?select=assurance&hub_id=eq.${LIVE}&token=eq.${sha256(res.body.token)}`)) as Row[];
    expect(sessions).toEqual([{ assurance: "code" }]);

    const again = await call("POST", "/auth/verify-invite", host(LIVE), { token: token(1) });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("invite_unusable");
  });

  it("is dead once expired, and on another hub", async () => {
    await plant(LIVE, addr("link-late"), token(2), -1000);
    expect((await call("POST", "/auth/verify-invite", host(LIVE), { token: token(2) })).body.code).toBe("invite_unusable");
    await plant(LIVE, addr("link-elsewhere"), token(3));
    expect((await call("POST", "/auth/verify-invite", host(BETA), { token: token(3) })).body.code).toBe("invite_unusable");
  });

  it("on a beta hub, keeps working but doesn't let in an address that is no longer allowed", async () => {
    await plant(BETA, addr("link-beta"), token(4));
    const res = await call("POST", "/auth/verify-invite", host(BETA), { token: token(4) });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("beta_closed");
    const rows = (await localRest(`hub_invites?select=used_at&hub_id=eq.${BETA}&email=eq.${encodeURIComponent(addr("link-beta"))}`)) as Row[];
    expect(rows[0]!.used_at).toBeNull();
  });
});
