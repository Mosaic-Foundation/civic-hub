// The super admin (src/control/), Phase 5 part one (2026-09-26).
//
// Needs a server with CIVIC_CONSOLE_HOSTNAME=console.localhost and
// CIVIC_CONSOLE_ADMIN_EMAIL=operator@example.test (CI sets both), on the
// local stack. Every hub this file creates is archived in afterAll, so the
// per-hub job runs in crons.test.ts see only Floyd and Athens: an archived
// hub is suspended, and jobs walk active hubs. (A hub cannot be deleted: its
// audit rows reference it, and the audit log is append-only. That is the
// rule working: an archived hub's slug stays taken.)

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import { call } from "../fixtures/hostCall.js";
import { API_BASE } from "../fixtures/helpers.js";
import { localRest, localStack } from "../fixtures/adminSession.js";
import {
  CONSOLE_HOST,
  OPERATOR,
  auditFor,
  consoleCall,
  mintConsoleSession,
  plantCode,
} from "../fixtures/consoleCall.js";

const run = Date.now().toString(36);
const SLUG = `ctl-${run}`;
const HOST = `ctl-${run}.localhost`;
const created: string[] = [];
let cookie = "";

/** A browser-style GET on `host`, not following redirects: status and Location. */
function rawGet(path: string, host: string): Promise<{ status: number; location: string | undefined }> {
  const url = new URL(`${API_BASE}${path}`);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: "GET", headers: { Host: host, Accept: "text/html" } },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0, location: res.headers.location }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function stepCode(): Promise<string> {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantCode("step_up", code);
  return code;
}

beforeAll(async () => {
  cookie = await mintConsoleSession();
});

afterAll(async () => {
  for (const id of created) {
    const res = await consoleCall("POST", `/control/hubs/${id}/archive`, { cookie, body: { step_up_code: await stepCode() } });
    if (res.status !== 200 && !/already archived/.test(res.body.error ?? "")) {
      throw new Error(`could not archive ${id}: ${JSON.stringify(res.body)}`);
    }
  }
});

describe("the console answers on its own hostname only", () => {
  it("its routes are not reachable on a hub's hostname", async () => {
    const onHub = await consoleCall("GET", "/control/session", { host: "athens.localhost" });
    expect(onHub.status).toBe(404);
    expect(onHub.body.operator_configured).toBeUndefined();
  });

  it("a hub's routes are not reachable on the console hostname", async () => {
    const res = await consoleCall("GET", "/hub-config");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });

  it("says whether an operator is configured, and who is signed in", async () => {
    const out = await consoleCall("GET", "/control/session");
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ email: null, operator_configured: true, console_hostname: CONSOLE_HOST });
    const inn = await consoleCall("GET", "/control/session", { cookie });
    expect(inn.body.email).toBe(OPERATOR);
  });
});

describe("sign-in", () => {
  it("answers the same for a stranger, and stores nothing for them", async () => {
    const stranger = `stranger-${run}@example.test`;
    const res = await consoleCall("POST", "/control/auth/request-code", { body: { email: stranger } });
    expect(res.status).toBe(200);
    const rows = (await localRest(`control_codes?email=eq.${encodeURIComponent(stranger)}`)) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it("a code signs the operator in with an HttpOnly, SameSite=Strict cookie, and is spent", async () => {
    await plantCode("sign_in", "246810");
    const res = await consoleCall("POST", "/control/auth/verify", { body: { email: OPERATOR, code: "246810" } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.setCookie).toMatch(/^civic_console=[^;]+;/);
    expect(res.setCookie).toContain("HttpOnly");
    expect(res.setCookie).toContain("SameSite=Strict");
    const again = await consoleCall("POST", "/control/auth/verify", { body: { email: OPERATOR, code: "246810" } });
    expect(again.status).toBe(401);
  });

  it("a wrong code is refused", async () => {
    await plantCode("sign_in", "135791");
    const res = await consoleCall("POST", "/control/auth/verify", { body: { email: OPERATOR, code: "000000" } });
    expect(res.status).toBe(401);
  });

  it("refuses writes without the console header, and reads without a session", async () => {
    expect((await consoleCall("POST", "/control/hubs", { cookie, csrf: false, body: {} })).status).toBe(403);
    expect((await consoleCall("GET", "/control/hubs")).status).toBe(401);
  });
});

describe("create hub", () => {
  it("refuses a reserved slug, naming what it is for", async () => {
    const res = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: { slug: "console", name: "X", hostname: `x-${run}.localhost`, admin_email: "a@example.test", hub_kind: "other" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("reserved");
  });

  it("refuses a hub without a first admin", async () => {
    const res = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: { slug: `noadmin-${run}`, name: "X", hostname: `noadmin-${run}.localhost`, hub_kind: "other" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("admin");
  });

  it("creates a demo hub by default, which serves at its hostname", async () => {
    const res = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: {
        slug: SLUG,
        name: "Console Test Hub",
        hostname: HOST,
        jurisdiction_name: "Testing, Nowhere",
        jurisdiction_custom: true,
        governing_body: "Testing Council",
        admin_email: `first-admin-${run}@example.test`,
        // Who runs it (review R48, session 4).
        ownership: {
          "legal.operator_name": "the Testing Moderators",
          "legal.contact_email": `hello-${run}@example.test`,
          "email.postal_address": "PO Box 1, Testing",
          "plugin.feedback.contact_email": `feedback-${run}@example.test`,
        },
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(SLUG);
    expect(res.body.hub).toMatchObject({ id: SLUG, hostname: HOST, mode: "demo", status: "active", archived_at: null });
    expect(res.body.admins).toEqual([`first-admin-${run}@example.test`]);
    expect(res.body.handover.values["copy.governing_body_name"]).toBe("Testing Council");
    expect(res.body.handover).toMatchObject({
      editable: true,
      values: {
        "identity.name": "Console Test Hub",
        "legal.operator_name": "the Testing Moderators",
        "legal.contact_email": `hello-${run}@example.test`,
        "email.from_name": "Console Test Hub",
        "email.postal_address": "PO Box 1, Testing",
        "plugin.feedback.contact_email": `feedback-${run}@example.test`,
      },
    });
    // The first admin is told (review R38); locally, with no mail key, the invite is logged.
    expect(res.body.invites).toEqual({ sent: [`first-admin-${run}@example.test`], not_sent: [] });
    expect(res.body.message).toContain("Sent the admin invite");

    const config = await call("GET", "/hub-config", HOST);
    expect(config.status).toBe(200);
    expect(config.body.hub).toMatchObject({ id: SLUG, mode: "demo" });
    // Every new hub starts with the platform's banner, as its own setting
    // (2026-10-08), which the admin can replace or clear.
    expect(config.body.settings["identity.banner_url"]).toBe("/hub-banner-default.webp");
    expect(config.body.settings["identity.banner_alt"]).toBeTruthy();
    // The Feedback page's address is public; the postal address is not.
    expect(config.body.settings["plugin.feedback.contact_email"]).toBe(`feedback-${run}@example.test`);
    expect(config.body.settings["legal.operator_name"]).toBe("the Testing Moderators");
    expect(config.body.settings["email.postal_address"]).toBeUndefined();

    const audit = await auditFor(SLUG);
    expect(audit[0]).toMatchObject({ action: "hub.create", actor_email: OPERATOR, before: null });
    expect(audit[0].after.hub.id).toBe(SLUG);
    expect(audit[0].after.settings["people.admin_emails"]).toContain(`first-admin-${run}@example.test`);
  });

  it("refuses a slug or hostname that is taken", async () => {
    const dup = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: { slug: SLUG, name: "Again", hostname: `other-${run}.localhost`, admin_email: "a@example.test", hub_kind: "other" },
    });
    expect(dup.status).toBe(409);
    const host = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: { slug: `other-${run}`, name: "Again", hostname: HOST, admin_email: "a@example.test", hub_kind: "other" },
    });
    expect(host.status).toBe(409);
  });

  it("lists it", async () => {
    const res = await consoleCall("GET", "/control/hubs", { cookie });
    expect(res.body.hubs.map((h: { id: string }) => h.id)).toContain(SLUG);
  });
});

describe("edit a hub", () => {
  it("a name change needs no step-up, reaches the site and the emails on a demo hub, and is audited", async () => {
    const res = await consoleCall("PATCH", `/control/hubs/${SLUG}`, { cookie, body: { name: "Renamed Test Hub" } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.hub.name).toBe("Renamed Test Hub");
    // The followers that still read the old name follow (review R11); the
    // operator the form set to something else stays.
    expect(res.body.follow_on.carried).toEqual({ "identity.name": "Renamed Test Hub", "email.from_name": "Renamed Test Hub" });
    expect(res.body.message).toContain("Hub name, Email from name");
    expect(res.body.handover.values["legal.operator_name"]).toBe("the Testing Moderators");
    const site = await call("GET", "/hub-config", HOST);
    expect(site.body.settings["identity.name"]).toBe("Renamed Test Hub");
    const last = (await auditFor(SLUG)).at(-1)!;
    expect(last).toMatchObject({
      action: "hub.update",
      before: { name: "Console Test Hub" },
      after: { name: "Renamed Test Hub" },
    });
  });

  it("a hostname change needs step-up; with it, the hub moves and the old hostname stays taken", async () => {
    const moved = `ctl-moved-${run}.localhost`;
    const without = await consoleCall("PATCH", `/control/hubs/${SLUG}`, { cookie, body: { hostname: moved } });
    expect(without.status).toBe(403);
    expect(without.body.error).toBe("step_up_required");

    const res = await consoleCall("PATCH", `/control/hubs/${SLUG}`, {
      cookie,
      body: { hostname: moved, step_up_code: await stepCode() },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await call("GET", "/hub-config", moved)).body.hub.id).toBe(SLUG);

    const reuse = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: { slug: `reuse-${run}`, name: "Reuse", hostname: HOST, admin_email: "a@example.test", hub_kind: "other" },
    });
    expect(reuse.status).toBe(409);
    expect(reuse.body.error).toContain("stays taken");
    expect(res.body.config.previous_hostnames).toContain(HOST);
  });

  it("does not change a hub's mode: that is its admins' (review R10, session 4)", async () => {
    for (const mode of ["beta", "demo"]) {
      const res = await consoleCall("PATCH", `/control/hubs/${SLUG}`, { cookie, body: { mode, step_up_code: await stepCode() } });
      expect(res.status).toBe(409);
      expect(res.body.error).toContain("Settings → Mode");
    }
    expect((await consoleCall("GET", `/control/hubs/${SLUG}`, { cookie })).body.hub.mode).toBe("demo");
  });

  it("a step-up code refused for a bad change is not spent", async () => {
    const code = await stepCode();
    const bad = await consoleCall("PATCH", `/control/hubs/${SLUG}`, {
      cookie,
      body: { hostname: "Not A Host", step_up_code: code },
    });
    expect(bad.status).toBe(409);
    const rows = (await localRest(`control_codes?email=eq.${encodeURIComponent(OPERATOR)}&purpose=eq.step_up`)) as unknown[];
    expect(rows).toHaveLength(1);
  });
});

describe("plugins and admins", () => {
  it("shows plugins read-only: after create they are the hub's admins' (review R10)", async () => {
    const res = await consoleCall("PUT", `/control/hubs/${SLUG}/plugins`, { cookie, body: { plugins: { wordcloud: false } } });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Settings → Plugins");
    const detail = (await consoleCall("GET", `/control/hubs/${SLUG}`, { cookie })).body;
    expect(detail.plugins.find((p: { id: string }) => p.id === "wordcloud")).toMatchObject({ enabled: true });
  });

  it("adds an admin only with step-up and emails them; removes one only with it; never empties the list", async () => {
    const first = `first-admin-${run}@example.test`;
    const second = `second-admin-${run}@example.test`;
    // Adding needs a fresh code too now, as on the hub's side (review R52).
    const unconfirmed = await consoleCall("PUT", `/control/hubs/${SLUG}/admins`, { cookie, body: { admins: [first, second] } });
    expect(unconfirmed.status).toBe(403);
    expect(unconfirmed.body.error).toBe("step_up_required");
    const add = await consoleCall("PUT", `/control/hubs/${SLUG}/admins`, {
      cookie,
      body: { admins: [first, second], step_up_code: await stepCode() },
    });
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    expect(add.body.admins).toEqual([first, second]);
    // Only the one added gets the invite (review R38).
    expect(add.body.invites).toEqual({ sent: [second], not_sent: [] });

    const remove = await consoleCall("PUT", `/control/hubs/${SLUG}/admins`, { cookie, body: { admins: [second] } });
    expect(remove.status).toBe(403);
    const removed = await consoleCall("PUT", `/control/hubs/${SLUG}/admins`, {
      cookie,
      body: { admins: [second], step_up_code: await stepCode() },
    });
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(removed.body.admins).toEqual([second]);
    expect((await auditFor(SLUG)).at(-1)).toMatchObject({ action: "hub.admins", before: [first, second], after: [second] });

    const empty = await consoleCall("PUT", `/control/hubs/${SLUG}/admins`, { cookie, body: { admins: [] } });
    expect(empty.status).toBe(400);
  });
});

describe("archive", () => {
  const slug = `ctl-arch-${run}`;
  const host = `ctl-arch-${run}.localhost`;

  beforeAll(async () => {
    const res = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: { slug, name: "Archive Me", hostname: host, admin_email: "a@example.test", hub_kind: "other" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(slug);
  });

  it("needs step-up, then suspends the hub and keeps its slug and hostname taken", async () => {
    expect((await consoleCall("POST", `/control/hubs/${slug}/archive`, { cookie, body: {} })).status).toBe(403);
    const res = await consoleCall("POST", `/control/hubs/${slug}/archive`, { cookie, body: { step_up_code: await stepCode() } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.hub.status).toBe("suspended");
    expect(res.body.hub.archived_at).toBeTruthy();

    expect((await call("GET", "/hub-config", host)).status).toBe(503);

    const again = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: { slug, name: "Again", hostname: `fresh-${run}.localhost`, admin_email: "a@example.test", hub_kind: "other" },
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toContain("archived");
    const sameHost = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: { slug: `fresh-${run}`, name: "Again", hostname: host, admin_email: "a@example.test", hub_kind: "other" },
    });
    expect(sameHost.status).toBe(409);
    expect(sameHost.body.error).toContain("archived");
  });

  it("unarchive clears archived_at and leaves the hub suspended", async () => {
    const res = await consoleCall("POST", `/control/hubs/${slug}/unarchive`, { cookie, body: {} });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.hub).toMatchObject({ archived_at: null, status: "suspended" });
    const actions = (await auditFor(slug)).map((a) => a.action);
    expect(actions).toEqual(["hub.create", "hub.archive", "hub.unarchive"]);
  });

  it("the audit log is append-only, even for the service role", async () => {
    const { url, key } = localStack();
    for (const method of ["DELETE", "PATCH"]) {
      const res = await fetch(`${url}/rest/v1/control_audit_log?target_hub_id=eq.${slug}`, {
        method,
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: method === "PATCH" ? JSON.stringify({ action: "rewritten" }) : undefined,
      });
      // 42501 twice over: the service role holds only SELECT and INSERT on
      // this table, and behind that grant a trigger refuses UPDATE and DELETE.
      expect(res.ok, method).toBe(false);
      expect((await res.json()).code).toBe("42501");
    }
    expect((await auditFor(slug)).length).toBe(3);
  });
});

describe("audit log view", () => {
  it("lists entries, newest first, filterable by hub", async () => {
    const res = await consoleCall("GET", `/control/audit?hub=${SLUG}`, { cookie });
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeGreaterThan(3);
    expect(res.body.entries.every((e: { target_hub_id: string }) => e.target_hub_id === SLUG)).toBe(true);
    expect(res.body.entries[0].id).toBeGreaterThan(res.body.entries.at(-1).id);
  });
});

// Session 4 (2026-10-08): handing a hub over.
describe("handover", () => {
  const slug = `ctl-ho-${run}`;
  const oldHost = `ctl-ho-old-${run}.localhost`;
  const newHost = `ctl-ho-new-${run}.localhost`;

  beforeAll(async () => {
    const res = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: { slug, name: "Handover Hub", hostname: oldHost, admin_email: `ho-${run}@example.test`, hub_kind: "other" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(slug);
  });

  it("edits what residents see while the hub is a demo; a new hub name carries, audited", async () => {
    const res = await consoleCall("PUT", `/control/hubs/${slug}/handover`, {
      cookie,
      body: {
        values: {
          "identity.name": "Handed Over Hub",
          "legal.who_runs_this": "Run by the volunteers of the Handed Over Hub.",
          "email.postal_address": "PO Box 9",
        },
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Operator and from-name still read the old name, so they follow; the registry name too.
    expect(res.body.follow_on.carried).toEqual({
      "legal.operator_name": "Handed Over Hub",
      "email.from_name": "Handed Over Hub",
      "hubs.name": "Handed Over Hub",
    });
    expect(res.body.hub.name).toBe("Handed Over Hub");
    expect(res.body.handover.values["email.postal_address"]).toBe("PO Box 9");
    expect(res.body.handover.changed["email.postal_address"].by).toBe(`console:${OPERATOR}`);
    const site = await call("GET", "/hub-config", oldHost);
    expect(site.body.settings["identity.name"]).toBe("Handed Over Hub");
    expect(site.body.settings["legal.operator_name"]).toBe("Handed Over Hub");
    expect((await auditFor(slug)).at(-1)).toMatchObject({ action: "hub.handover", after: { "identity.name": "Handed Over Hub" } });
  });

  it("refuses a bad value in plain words, and a key that is not the panel's", async () => {
    const bad = await consoleCall("PUT", `/control/hubs/${slug}/handover`, { cookie, body: { values: { "legal.contact_email": "nope" } } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/^Contact address/);
    const other = await consoleCall("PUT", `/control/hubs/${slug}/handover`, { cookie, body: { values: { "people.admin_emails": "[]" } } });
    expect(other.status).toBe(400);
  });

  it("moving the hub keeps the old address working: pages and API redirect, the page shell gets hub_moved", async () => {
    const res = await consoleCall("PATCH", `/control/hubs/${slug}`, { cookie, body: { hostname: newHost, step_up_code: await stepCode() } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.config.previous_hostnames).toEqual([oldHost]);

    const page = await rawGet("/process/abc?ref=share", oldHost);
    expect(page.status).toBe(301);
    expect(page.location).toMatch(new RegExp(`^http://${newHost.replace(/\./g, "\\.")}(:\\d+)?/process/abc\\?ref=share$`));

    const shell = await call("GET", "/hub-config", oldHost);
    expect(shell.status).toBe(404);
    expect(shell.body.error).toBe("hub_moved");
    expect(shell.body.location).toMatch(new RegExp(`^http://${newHost.replace(/\./g, "\\.")}`));

    expect((await call("GET", "/hub-config", newHost)).body.hub.id).toBe(slug);
  });

  it("once the hub's admins move it out of demo, the panel is read-only and a rename says what it did not change", async () => {
    // The hub's own Settings → Mode does this with a fresh code; the row is set directly here.
    await localRest(`hubs?id=eq.${slug}`, { method: "PATCH", body: JSON.stringify({ mode: "beta" }) });
    const detail = (await consoleCall("GET", `/control/hubs/${slug}`, { cookie })).body;
    expect(detail.handover.editable).toBe(false);

    const refused = await consoleCall("PUT", `/control/hubs/${slug}/handover`, { cookie, body: { values: { "email.from_name": "X" } } });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain("left demo");

    const renamed = await consoleCall("PATCH", `/control/hubs/${slug}`, { cookie, body: { name: "Registry Only" } });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body.follow_on.carried).toEqual({});
    expect(renamed.body.message).toContain("Only the registry name changed");
    expect((await call("GET", "/hub-config", newHost)).body.settings["identity.name"]).toBe("Handed Over Hub");
  });

  it("names refreshed samples by title", async () => {
    const demo = `ctl-smp-${run}`;
    const res = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: { slug: demo, name: "Sample Titles", hostname: `${demo}.localhost`, admin_email: `s-${run}@example.test`, hub_kind: "organization" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(demo);
    const refreshed = await consoleCall("POST", `/control/hubs/${demo}/samples/refresh`, { cookie, body: {} });
    expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200);
    const titles = refreshed.body.titles as Record<string, string>;
    expect(Object.keys(titles).length).toBeGreaterThan(10);
    for (const key of refreshed.body.refresh.added as string[]) expect(titles[key], key).toBeTruthy();
    expect(Object.values(titles).some((t) => /\{[A-Z_]+\}/.test(t))).toBe(false);
  });
});
