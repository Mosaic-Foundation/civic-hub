// Session 4 (2026-10-08): the hub's own side of a handover. On a hub the
// console creates (so Athens and Floyd are untouched):
//   - hub Settings says the platform may also set what residents see while
//     the hub is a demo, and names a console write "the platform operator";
//   - a new hub name in Settings → Identity carries to the operator, the
//     email sender name and the registry name (review R11);
//   - the Feedback page's address is a public setting (docs item #6);
//   - adding an admin in Settings → Admins & board emails them (review R38).
//
// Needs the console's env, like tests/api/control.test.ts
// (CIVIC_CONSOLE_HOSTNAME=console.localhost, CIVIC_CONSOLE_ADMIN_EMAIL).
// The hub is archived in afterAll.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";

const run = Date.now().toString(36);
const SLUG = `ho-${run}`;
const HOST = `ho-${run}.localhost`;
const ADMIN = `ho-admin-${run}@example.test`;
let cookie = "";
let token = "";

async function stepCode(): Promise<string> {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantCode("step_up", code);
  return code;
}

/** A hub admin's step-up code, as the emailed one would have been stored. */
async function hubCode(email: string): Promise<string> {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await localRest("pending_verifications", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ hub_id: SLUG, email, code, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), attempts: 0 }),
  });
  return code;
}

beforeAll(async () => {
  cookie = await mintConsoleSession();
  const res = await consoleCall("POST", "/control/hubs", {
    cookie,
    body: {
      slug: SLUG,
      name: "Handover Side Hub",
      hostname: HOST,
      admin_email: ADMIN,
      hub_kind: "organization",
      ownership: { "legal.contact_email": `contact-${run}@example.test` },
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  token = await mintSession(SLUG, ADMIN);
});

afterAll(async () => {
  await consoleCall("POST", `/control/hubs/${SLUG}/archive`, { cookie, body: { step_up_code: await stepCode() } });
});

describe("hub Settings during a demo", () => {
  it("says the platform may also set what residents see, and names a console write as the platform operator", async () => {
    const res = await call("GET", "/admin/hub/settings", HOST, undefined, token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.console_may_edit).toBe(true);
    expect(res.body.changed["legal.operator_name"].by).toBe("the platform operator");
  });

  it("a new hub name carries to the operator, the email sender and the registry", async () => {
    const res = await call("PUT", "/admin/hub/settings", HOST, { section: "identity", values: { "identity.name": "Our Own Hub" } }, token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.values["identity.name"]).toBe("Our Own Hub");
    expect(res.body.follow_on).toContain("Operated by, Email from name, the name in the hub registry");

    const site = await call("GET", "/hub-config", HOST);
    expect(site.body.settings["legal.operator_name"]).toBe("Our Own Hub");
    const detail = (await consoleCall("GET", `/control/hubs/${SLUG}`, { cookie })).body;
    expect(detail.hub.name).toBe("Our Own Hub");
    expect(detail.handover.values["email.from_name"]).toBe("Our Own Hub");
  });

  it("an operator the admin made their own does not follow the next rename", async () => {
    const legal = await call("PUT", "/admin/hub/settings", HOST, { section: "legal", values: { "legal.operator_name": "Our Volunteers" } }, token);
    expect(legal.status).toBe(200);
    const res = await call("PUT", "/admin/hub/settings", HOST, { section: "identity", values: { "identity.name": "Our Hub" } }, token);
    expect(res.body.follow_on).not.toContain("Operated by");
    expect((await call("GET", "/hub-config", HOST)).body.settings["legal.operator_name"]).toBe("Our Volunteers");
  });
});

describe("the feedback address (docs item #6)", () => {
  it("is set under Plugins and served publicly", async () => {
    const res = await call(
      "PUT",
      "/admin/hub/settings",
      HOST,
      { section: "plugins", values: { "plugin.feedback.contact_email": `fb-${run}@example.test` } },
      token,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const site = await call("GET", "/hub-config", HOST);
    expect(site.body.settings["plugin.feedback.contact_email"]).toBe(`fb-${run}@example.test`);
  });

  it("refuses something that is not an address", async () => {
    const res = await call("PUT", "/admin/hub/settings", HOST, { section: "plugins", values: { "plugin.feedback.contact_email": "nope" } }, token);
    expect(res.status).toBe(400);
  });
});

describe("adding an admin from the hub", () => {
  it("emails the new admin, and only them", async () => {
    const added = `ho-second-${run}@example.test`;
    const res = await call(
      "POST",
      "/admin/hub/people",
      HOST,
      { admin_emails: [ADMIN, added], code: await hubCode(ADMIN) },
      token,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.admin_emails).toEqual([ADMIN, added]);
    expect(res.body.invites).toEqual({ sent: [added], not_sent: [] });
    expect(res.body.invite_message).toContain(added);
  });
});

describe("after handover", () => {
  it("the note goes once the hub leaves demo", async () => {
    await localRest(`hubs?id=eq.${SLUG}`, { method: "PATCH", body: JSON.stringify({ mode: "beta" }) });
    // The resolver caches the registry for a minute; the console's write
    // path invalidates it, a direct row write does not, so ask the console to.
    await consoleCall("PATCH", `/control/hubs/${SLUG}`, { cookie, body: { name: "Our Hub (beta)" } });
    const res = await call("GET", "/admin/hub/settings", HOST, undefined, token);
    expect(res.body.console_may_edit).toBe(false);
  });
});
