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
import { call } from "../fixtures/hostCall.js";
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
      body: { slug: "console", name: "X", hostname: `x-${run}.localhost`, admin_email: "a@example.test" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("reserved");
  });

  it("refuses a hub without a first admin", async () => {
    const res = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: { slug: `noadmin-${run}`, name: "X", hostname: `noadmin-${run}.localhost` },
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
        jurisdiction_code: "us-xx-testing",
        governing_body: "Testing Council",
        admin_email: `first-admin-${run}@example.test`,
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(SLUG);
    expect(res.body.hub).toMatchObject({ id: SLUG, hostname: HOST, mode: "demo", status: "active", archived_at: null });
    expect(res.body.admins).toEqual([`first-admin-${run}@example.test`]);
    expect(res.body.config.governing_body).toBe("Testing Council");

    const config = await call("GET", "/hub-config", HOST);
    expect(config.status).toBe(200);
    expect(config.body.hub).toMatchObject({ id: SLUG, mode: "demo" });

    const audit = await auditFor(SLUG);
    expect(audit[0]).toMatchObject({ action: "hub.create", actor_email: OPERATOR, before: null });
    expect(audit[0].after.hub.id).toBe(SLUG);
    expect(audit[0].after.settings["people.admin_emails"]).toContain(`first-admin-${run}@example.test`);
  });

  it("refuses a slug or hostname that is taken", async () => {
    const dup = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: { slug: SLUG, name: "Again", hostname: `other-${run}.localhost`, admin_email: "a@example.test" },
    });
    expect(dup.status).toBe(409);
    const host = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: { slug: `other-${run}`, name: "Again", hostname: HOST, admin_email: "a@example.test" },
    });
    expect(host.status).toBe(409);
  });

  it("lists it", async () => {
    const res = await consoleCall("GET", "/control/hubs", { cookie });
    expect(res.body.hubs.map((h: { id: string }) => h.id)).toContain(SLUG);
  });
});

describe("edit a hub", () => {
  it("a name change needs no step-up, and is audited with before and after", async () => {
    const res = await consoleCall("PATCH", `/control/hubs/${SLUG}`, { cookie, body: { name: "Renamed Test Hub" } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.hub.name).toBe("Renamed Test Hub");
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
      body: { slug: `reuse-${run}`, name: "Reuse", hostname: HOST, admin_email: "a@example.test" },
    });
    expect(reuse.status).toBe(409);
    expect(reuse.body.error).toContain("stays taken");
  });

  it("will not move an existing hub into demo", async () => {
    const res = await consoleCall("PATCH", `/control/hubs/${SLUG}`, {
      cookie,
      body: { mode: "beta", step_up_code: await stepCode() },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const back = await consoleCall("PATCH", `/control/hubs/${SLUG}`, {
      cookie,
      body: { mode: "demo", step_up_code: await stepCode() },
    });
    expect(back.status).toBe(400);
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
  it("switches a plugin off for that hub, audited", async () => {
    const res = await consoleCall("PUT", `/control/hubs/${SLUG}/plugins`, { cookie, body: { plugins: { wordcloud: false } } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.plugins.find((p: { id: string }) => p.id === "wordcloud")).toMatchObject({ enabled: false, source: "hub" });
    const hub = (await consoleCall("GET", `/control/hubs/${SLUG}`, { cookie })).body.hub;
    const config = await call("GET", "/hub-config", hub.hostname);
    expect(config.body.settings["plugin.wordcloud.enabled"]).toBe("false");
    expect((await auditFor(SLUG)).at(-1)).toMatchObject({
      action: "hub.plugins",
      before: { wordcloud: true },
      after: { wordcloud: false },
    });
  });

  it("refuses an unknown plugin", async () => {
    const res = await consoleCall("PUT", `/control/hubs/${SLUG}/plugins`, { cookie, body: { plugins: { nope: false } } });
    expect(res.status).toBe(400);
  });

  it("adds an admin without step-up, removes one only with it, and never empties the list", async () => {
    const first = `first-admin-${run}@example.test`;
    const second = `second-admin-${run}@example.test`;
    const add = await consoleCall("PUT", `/control/hubs/${SLUG}/admins`, { cookie, body: { admins: [first, second] } });
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    expect(add.body.admins).toEqual([first, second]);

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
      body: { slug, name: "Archive Me", hostname: host, admin_email: "a@example.test" },
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
      body: { slug, name: "Again", hostname: `fresh-${run}.localhost`, admin_email: "a@example.test" },
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toContain("archived");
    const sameHost = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: { slug: `fresh-${run}`, name: "Again", hostname: host, admin_email: "a@example.test" },
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
