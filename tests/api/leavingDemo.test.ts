import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession, plantHubCode } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession } from "../fixtures/consoleCall.js";
import { freshTestIp } from "../fixtures/helpers.js";
import { CURRENT_LEGAL_VERSION } from "../../src/shared/legal.js";

/**
 * Leaving demo, and going live (leaving-demo slice, 2026-10-15), over HTTP on
 * two fresh demo hubs made through the console: one keeps its samples, one
 * removes them with the switch.
 *
 *   - Mode's readiness list: the time zone and postal address block, the rest
 *     may be accepted, and the switch is refused (before the code is spent)
 *     until they are;
 *   - what a switch keeps: nothing is deleted but the optional sample
 *     removal; sample members and demo-only accounts stop counting;
 *   - board members through the beta gate;
 *   - going live tells the waitlist once, and live → beta names who it locks out.
 */

const run = Date.now().toString(36);
const KEEP = `ldk-${run}`;
const KEEP_HOST = `${KEEP}.localhost`;
const REMOVE = `ldr-${run}`;
const REMOVE_HOST = `${REMOVE}.localhost`;
const ADMIN = `ld-admin-${run}@example.test`;
const BOARD = `ld-board-${run}@example.test`;
const ALL_ACCEPTABLE = ["name_and_place", "contact_email", "second_admin", "legal_reviewed", "samples"];

let cookie = "";
const admin: Record<string, string> = {};

async function createDemoHub(slug: string, host: string): Promise<void> {
  const res = await consoleCall("POST", "/control/hubs", {
    cookie,
    body: {
      slug,
      name: `Leaving Demo ${slug}`,
      hostname: host,
      admin_email: ADMIN,
      hub_kind: "place",
      jurisdiction_name: "Test Township",
      jurisdiction_type: "town",
      jurisdiction_custom: true,
      // No time zone: a custom place gets no suggestion, so readiness blocks.
      timezone: "",
      mode: "demo",
      sample_content: true,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

async function settings(host: string, section: string, values: Record<string, string>): Promise<void> {
  const res = await call("PUT", "/admin/hub/settings", host, { section, values }, admin[host]);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/** A demo visitor's own proposal, live after the (fake) Code of Conduct check. */
async function visitorProposal(host: string, email: string): Promise<string> {
  const ip = freshTestIp();
  await call("POST", "/auth/request-code", host, { email }, undefined, ip);
  const v = await call("POST", "/auth/verify", host, { email, code: "123456" }, undefined, ip);
  expect(v.status, JSON.stringify(v.body)).toBe(200);
  const t = v.body.token as string;
  await call("POST", "/auth/residency", host, { affirmed: true, full_name: "Demo Visitor" }, t);
  await call("POST", "/auth/accept-tos", host, { version: CURRENT_LEGAL_VERSION }, t);
  const draft = await call("POST", "/proposals/drafts", host, { category: "idea" }, t);
  await call("PATCH", `/proposals/drafts/${draft.body.id}`, host, { title: `A visitor's idea ${run}`, description: "Added while the hub was a demo." }, t);
  const sub = await call("POST", `/proposals/drafts/${draft.body.id}/submit`, host, {}, t);
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  return sub.body.process_id as string;
}

async function adminVote(host: string): Promise<string> {
  const created = await call("POST", "/process", host, {
    definition: { type: "civic.vote", version: "0.1" },
    title: `An admin's vote ${run}`,
    description: "Made before leaving demo.",
    state: { options: ["Yes", "No"], voting_duration_ms: 14 * 86_400_000, activation_mode: "direct" },
  }, admin[host]);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  await call("POST", `/process/${created.body.id}/action`, host, { type: "process.activate", payload: {} }, admin[host]);
  return created.body.id as string;
}

async function adminAnnouncement(host: string): Promise<string> {
  const res = await call("POST", "/announcement", host, { title: `An admin's announcement ${run}`, body: "Made before leaving demo." }, admin[host]);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function switchMode(host: string, hub: string, body: Record<string, unknown>) {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantHubCode(hub, ADMIN, code);
  return { res: await call("POST", "/admin/hub/mode", host, { ...body, code }, admin[host]), code };
}

async function exists(host: string, id: string): Promise<boolean> {
  return (await call("GET", `/process/${id}`, host)).status === 200;
}

beforeAll(async () => {
  cookie = await mintConsoleSession();
  for (const [slug, host] of [[KEEP, KEEP_HOST], [REMOVE, REMOVE_HOST]] as const) {
    await createDemoHub(slug, host);
    admin[host] = await mintSession(slug, ADMIN);
  }
});

afterAll(async () => {
  for (const slug of [KEEP, REMOVE]) {
    await localRest(`hubs?id=eq.${slug}`, { method: "PATCH", body: JSON.stringify({ status: "suspended" }) }).catch(() => undefined);
  }
});

const made: Record<string, { vote: string; announcement: string; visitor: string }> = {};

describe("a hub made for a listed place", () => {
  it("gets its state's time zone when the console sends none", async (ctx) => {
    // The list CI loads (scripts/load-jurisdictions.ts); skip on a stack without it.
    const [row] = (await localRest("jurisdictions?select=ocd_id&ocd_id=like.*state:co/county:*&limit=1")) as Array<{ ocd_id: string }>;
    if (!row) return ctx.skip();
    const slug = `ldt-${run}`;
    const res = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: { slug, name: `Leaving Demo tz ${run}`, hostname: `${slug}.localhost`, admin_email: ADMIN, hub_kind: "place", jurisdiction_ocd_id: row.ocd_id, timezone: "", mode: "demo" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [tz] = (await localRest(`hub_settings?hub_id=eq.${slug}&key=eq.identity.timezone&select=value`)) as Array<{ value: string }>;
    expect(tz?.value).toBe("America/Denver");
  });
});

describe("before the switch: the readiness list", () => {
  it("lists every item, and the time zone and postal address block", async () => {
    made[KEEP_HOST] = { vote: await adminVote(KEEP_HOST), announcement: await adminAnnouncement(KEEP_HOST), visitor: await visitorProposal(KEEP_HOST, `ld-visitor-${run}@example.test`) };
    const res = await call("GET", "/admin/hub/mode/readiness?to=beta", KEEP_HOST, undefined, admin[KEEP_HOST]);
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{ id: string; done: boolean; blocking: boolean; link: string; accept_label?: string }>;
    expect(items.map((i) => i.id)).toEqual(["name_and_place", "timezone", "postal_address", "contact_email", "second_admin", "legal_reviewed", "samples"]);
    const tz = items.find((i) => i.id === "timezone")!;
    expect(tz).toMatchObject({ done: false, blocking: true, link: "/admin/settings/identity" });
    expect(items.find((i) => i.id === "postal_address")!.blocking).toBe(true);
    for (const i of items.filter((x) => !x.blocking)) expect(i.accept_label, i.id).toBeTruthy();
  });

  it("names the consequences in plain words", async () => {
    const res = await call("GET", "/admin/hub/mode/readiness?to=beta", KEEP_HOST, undefined, admin[KEEP_HOST]);
    const lines = (res.body.consequences.lines as string[]).join("\n");
    expect(lines).toMatch(/real code from their email/);
    expect(lines).toMatch(/1 person who looked around with "any six digits" is signed out/);
    expect(lines).toMatch(/goes only to admins and the allowlist/);
    expect(lines).toMatch(/The demo notice becomes the beta notice/);
    expect(lines).toMatch(/no way back to demo/);
  });

  it("refuses the switch while the time zone is unset, even with everything accepted, and keeps the code", async () => {
    // The platform's postal address may be configured (it counts); give the hub its own either way.
    await settings(KEEP_HOST, "email", { "email.postal_address": "1 Test Street, Test Township" });
    const { res, code } = await switchMode(KEEP_HOST, KEEP, { mode: "beta", accepted: ALL_ACCEPTABLE });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("mode_not_ready");
    expect(res.body.error).toMatch(/time zone/);
    // The code was not spent: it still works once the hub is ready.
    await settings(KEEP_HOST, "identity", { "identity.timezone": "America/Chicago" });
    const noAccept = await call("POST", "/admin/hub/mode", KEEP_HOST, { mode: "beta", code }, admin[KEEP_HOST]);
    expect(noAccept.status).toBe(400);
    expect(noAccept.body.error).toMatch(/Finish or accept/);
    const ok = await call("POST", "/admin/hub/mode", KEEP_HOST, { mode: "beta", code, accepted: ALL_ACCEPTABLE }, admin[KEEP_HOST]);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.mode).toBe("beta");
  });

  it("records what was accepted in the admin log", async () => {
    const log = await call("GET", "/admin/hub/admin-log", KEEP_HOST, undefined, admin[KEEP_HOST]);
    const entry = (log.body.entries ?? log.body.rows ?? log.body).find((r: { action: string }) => r.action === "hub.mode");
    expect(entry.after).toMatchObject({ mode: "beta" });
    expect(entry.after.accepted).toEqual(ALL_ACCEPTABLE);
  });
});

describe("what demo → beta keeps (samples kept)", () => {
  it("deletes nothing: the admin's vote and announcement, the visitor's proposal and the samples are all there", async () => {
    const m = made[KEEP_HOST];
    expect(await exists(KEEP_HOST, m.vote)).toBe(true);
    expect(await exists(KEEP_HOST, m.announcement)).toBe(true);
    expect(await exists(KEEP_HOST, m.visitor)).toBe(true);
    const samples = await call("GET", "/admin/hub/sample-content", KEEP_HOST, undefined, admin[KEEP_HOST]);
    expect(samples.body.processes).toBeGreaterThan(0);
  });

  it("stops counting sample members and the demo-only visitor", async () => {
    const summary = await call("GET", "/members/summary", KEEP_HOST, undefined, admin[KEEP_HOST]);
    expect(summary.status).toBe(200);
    // The admin alone: five sample accounts and one demo-only visitor left out.
    expect(summary.body.count).toBe(1);
    const [visitor] = (await localRest(`users?hub_id=eq.${KEEP}&email=eq.ld-visitor-${run}@example.test&select=demo_only`)) as Array<{ demo_only: boolean }>;
    expect(visitor.demo_only).toBe(true);
  });
});

describe("what demo → beta keeps (samples removed with the switch)", () => {
  it("removes only the samples and what visitors added in demo; the admin's content stays", async () => {
    made[REMOVE_HOST] = { vote: await adminVote(REMOVE_HOST), announcement: await adminAnnouncement(REMOVE_HOST), visitor: await visitorProposal(REMOVE_HOST, `ld-visitor2-${run}@example.test`) };
    await settings(REMOVE_HOST, "email", { "email.postal_address": "1 Test Street, Test Township" });
    await settings(REMOVE_HOST, "identity", { "identity.timezone": "America/Denver" });
    const accepted = ALL_ACCEPTABLE.filter((a) => a !== "samples");
    const { res } = await switchMode(REMOVE_HOST, REMOVE, { mode: "beta", accepted, remove_sample_content: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const m = made[REMOVE_HOST];
    expect(await exists(REMOVE_HOST, m.vote)).toBe(true);
    expect(await exists(REMOVE_HOST, m.announcement)).toBe(true);
    expect(await exists(REMOVE_HOST, m.visitor)).toBe(false);
    const samples = await call("GET", "/admin/hub/sample-content", REMOVE_HOST, undefined, admin[REMOVE_HOST]);
    expect(samples.body.processes + (samples.body.added_in_demo ?? 0)).toBe(0);
  });
});

describe("the first week of beta", () => {
  it("lets a board member sign in, and turns away someone on no list", async () => {
    const roster = await (async () => {
      const code = "771204";
      await plantHubCode(KEEP, ADMIN, code);
      return call("POST", "/admin/hub/people", KEEP_HOST, { admin_emails: [ADMIN], board_emails: [BOARD], code }, admin[KEEP_HOST]);
    })();
    expect(roster.status, JSON.stringify(roster.body)).toBe(200);
    expect((await call("POST", "/auth/request-code", KEEP_HOST, { email: BOARD })).status).toBe(200);
    const stranger = await call("POST", "/auth/request-code", KEEP_HOST, { email: `ld-stranger-${run}@example.test` });
    expect(stranger.status).toBe(403);
    expect(stranger.body.code).toBe("beta_closed");
  });
});

describe("beta → live, and back", () => {
  it("tells the waitlist the hub is open, once each", async () => {
    for (const who of ["one", "two"]) {
      const res = await call("POST", "/waitlist", KEEP_HOST, { email: `ld-wait-${who}-${run}@example.test` });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    const ready = await call("GET", "/admin/hub/mode/readiness?to=live", KEEP_HOST, undefined, admin[KEEP_HOST]);
    expect(ready.body.items.map((i: { id: string }) => i.id)).not.toContain("samples");
    expect(ready.body.consequences.waitlist_to_tell).toBe(2);
    expect((ready.body.consequences.lines as string[]).join("\n")).toMatch(/Anyone can sign in.*The allowlist no longer matters/);
    const accepted = ALL_ACCEPTABLE.filter((a) => a !== "samples");
    const { res } = await switchMode(KEEP_HOST, KEEP, { mode: "live", accepted });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.waitlist).toEqual({ told: 2, failed: 0 });
    const rows = (await localRest(`waitlist?hub_id=eq.${KEEP}&select=email,told_open_at`)) as Array<{ told_open_at: string | null }>;
    expect(rows.every((r) => r.told_open_at !== null)).toBe(true);
  });

  it("live → beta has no readiness list and names who it would lock out", async () => {
    // A member on no list: they joined while the hub was live.
    await mintSession(KEEP, `ld-member-${run}@example.test`);
    const res = await call("GET", "/admin/hub/mode/readiness?to=beta", KEEP_HOST, undefined, admin[KEEP_HOST]);
    expect(res.body.items).toEqual([]);
    expect((res.body.consequences.lines as string[]).join("\n")).toMatch(/1 member is on none of those lists/);
    const { res: down } = await switchMode(KEEP_HOST, KEEP, { mode: "beta" });
    expect(down.status, JSON.stringify(down.body)).toBe(200);
  });

  it("going live again tells only people who joined in between", async () => {
    await call("POST", "/waitlist", KEEP_HOST, { email: `ld-wait-three-${run}@example.test` });
    const accepted = ALL_ACCEPTABLE.filter((a) => a !== "samples");
    const { res } = await switchMode(KEEP_HOST, KEEP, { mode: "live", accepted });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.waitlist).toEqual({ told: 1, failed: 0 });
  });

  it("never goes back to demo", async () => {
    const { res } = await switchMode(KEEP_HOST, KEEP, { mode: "demo" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("mode_change_rejected");
  });
});
