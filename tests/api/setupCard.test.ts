// The home page's "Set up your hub" card (pilot readiness 2, 2026-11-02): the
// ticks come from the hub's state, and Dismiss and Skip belong to one admin's
// account. Needs the console's env, as handover.test.ts does.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { mintSession } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";

const run = Date.now().toString(36);
const SLUG = `card-${run}`;
const HOST = `${SLUG}.localhost`;
const ADMIN = `card-admin-${run}@example.test`;
const LATER = `card-later-${run}@example.test`;
let cookie = "";
let token = "";

type Step = { id: string; done: boolean; skipped: boolean; can_skip: boolean; link: string };
const step = (body: { steps: Step[] }, id: string) => body.steps.find((s) => s.id === id)!;

beforeAll(async () => {
  cookie = await mintConsoleSession();
  const res = await consoleCall("POST", "/control/hubs", {
    cookie,
    body: {
      slug: SLUG,
      name: "Card Hub",
      hostname: HOST,
      admin_email: ADMIN,
      hub_kind: "organization",
      // What creation writes doesn't count as the hub's admins having looked at Legal.
      ownership: { "legal.contact_email": `contact-${run}@example.test` },
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  token = await mintSession(SLUG, ADMIN);
});

afterAll(async () => {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantCode("step_up", code);
  await consoleCall("POST", `/control/hubs/${SLUG}/archive`, { cookie, body: { step_up_code: code } });
});

describe("the Set up your hub card", () => {
  it("is for admins", async () => {
    expect((await call("GET", "/admin/hub/setup-card", HOST)).status).toBe(401);
  });

  it("starts with the name ticked and the rest open", async () => {
    const res = await call("GET", "/admin/hub/setup-card", HOST, undefined, token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.dismissed).toBe(false);
    expect(res.body.steps.map((s: Step) => s.id)).toEqual(["name_and_place", "legal", "second_admin", "beta"]);
    expect(step(res.body, "name_and_place").done).toBe(true);
    expect(step(res.body, "legal").done).toBe(false);
    expect(step(res.body, "second_admin")).toMatchObject({ done: false, can_skip: true, skipped: false });
    expect(step(res.body, "beta").done).toBe(false);
  });

  it("ticks Legal when an admin saves it", async () => {
    const saved = await call("PUT", "/admin/hub/settings", HOST, { section: "legal", values: { "legal.operator_name": "Our Group" } }, token);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const res = await call("GET", "/admin/hub/setup-card", HOST, undefined, token);
    expect(step(res.body, "legal").done).toBe(true);
  });

  it("the save is in the admin log, by section and field, without the value", async () => {
    const log = await call("GET", "/admin/hub/admin-log", HOST, undefined, token);
    const row = (log.body.entries as Array<{ action: string; after: unknown; actor_email: string }>).find((e) => e.action === "settings.save");
    expect(row?.after).toEqual({ section: "legal", fields: ["legal.operator_name"] });
    expect(row?.actor_email).toBe(ADMIN);
    expect(JSON.stringify(log.body)).not.toContain("Our Group");
  });

  it("Skip ticks the second admin for this admin, marked as skipped", async () => {
    const res = await call("POST", "/admin/hub/setup-card", HOST, { action: "skip_second_admin" }, token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(step(res.body, "second_admin")).toMatchObject({ done: true, skipped: true });
  });

  it("refuses anything else", async () => {
    expect((await call("POST", "/admin/hub/setup-card", HOST, { action: "explode" }, token)).status).toBe(400);
  });

  it("Dismiss is per admin: a later admin still sees it, with the second admin done", async () => {
    const dismissed = await call("POST", "/admin/hub/setup-card", HOST, { action: "dismiss" }, token);
    expect(dismissed.body.dismissed).toBe(true);
    expect((await call("GET", "/admin/hub/setup-card", HOST, undefined, token)).body.dismissed).toBe(true);

    const code = String(100000 + Math.floor(Math.random() * 899999));
    await plantCode("step_up", code);
    const handover = await consoleCall("PUT", `/control/hubs/${SLUG}/admins`, { cookie, body: { admins: [ADMIN, LATER], step_up_code: code } });
    expect(handover.status, JSON.stringify(handover.body)).toBe(200);
    const later = await mintSession(SLUG, LATER);
    const res = await call("GET", "/admin/hub/setup-card", HOST, undefined, later);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.dismissed).toBe(false);
    expect(step(res.body, "second_admin")).toMatchObject({ done: true, skipped: false, can_skip: false });
  });
});
