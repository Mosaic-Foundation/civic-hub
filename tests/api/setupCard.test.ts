// The home page's "Set up your hub" card (pilot readiness 2, 2026-11-02): the
// ticks come from the hub's state, and Dismiss and Skip belong to one admin's
// account. Needs the operator API, as handover.test.ts does.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { mintSession } from "../fixtures/adminSession.js";
import { createHub, archiveHub, setAdmins } from "../fixtures/operator.js";

const run = Date.now().toString(36);
const SLUG = `card-${run}`;
const HOST = `${SLUG}.localhost`;
const ADMIN = `card-admin-${run}@example.test`;
const LATER = `card-later-${run}@example.test`;
let token = "";

type Step = { id: string; label: string; hint: string; done: boolean; skipped: boolean; can_skip: boolean; link: string; help: string };
const step = (body: { checklist: Step[] }, id: string) => body.checklist.find((s) => s.id === id)!;
const CHECKLIST = ["name_and_place", "banner", "logo", "theme", "copy", "legal", "email", "second_admin", "officials", "plugins", "beta"];

async function view() {
  const res = await call("GET", "/admin/hub/setup-card", HOST, undefined, token);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { dismissed: boolean; steps: Step[]; checklist: Step[] };
}

async function save(section: string, values: Record<string, string>) {
  const res = await call("PUT", "/admin/hub/settings", HOST, { section, values }, token);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

beforeAll(async () => {
  const res = await createHub({
      slug: SLUG,
      name: "Card Hub",
      hostname: HOST,
      admin_email: ADMIN,
      hub_kind: "organization",
      
      ownership: { "legal.contact_email": `contact-${run}@example.test` },
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  token = await mintSession(SLUG, ADMIN);
});

afterAll(async () => {
  await archiveHub(SLUG);
});

describe("the Set up your hub card", () => {
  it("is for admins", async () => {
    expect((await call("GET", "/admin/hub/setup-card", HOST)).status).toBe(401);
  });

  it("the checklist has every step, each with a link to its setting and a help key; the card has its first four", async () => {
    const body = await view();
    expect(body.dismissed).toBe(false);
    expect(body.checklist.map((s) => s.id)).toEqual(CHECKLIST);
    expect(body.steps).toEqual(body.checklist.slice(0, 4));
    for (const s of body.checklist) {
      expect(s.link, s.id).toMatch(/^\/admin\/settings\/[a-z-]+$/);
      expect(s.help, s.id).toMatch(/^[a-z_-]+\.[a-z_-]+$/);
      expect(s.hint.length, s.id).toBeGreaterThan(10);
    }
  });

  it("starts with what creation set ticked, and the rest open", async () => {
    const body = await view();
    // Creation names the hub and its email sender (the hub's name). This hub
    // has no place and so no zone yet: its first step waits for one (Events 3).
    expect(step(body, "name_and_place").done).toBe(false);
    expect(step(body, "email").done).toBe(true);
    for (const id of ["banner", "logo", "theme", "copy", "legal", "officials", "plugins", "beta"]) expect(step(body, id).done, id).toBe(false);
    expect(step(body, "second_admin")).toMatchObject({ done: false, can_skip: true, skipped: false });
  });

  it("ticks Name and place once the hub has a time zone of its own (Events 3)", async () => {
    await save("identity", { "identity.timezone": "UTC" });
    expect(step(await view(), "name_and_place").done).toBe(true);
  });

  it("ticks Legal when an admin saves it", async () => {
    await save("legal", { "legal.operator_name": "Our Group" });
    expect(step(await view(), "legal").done).toBe(true);
  });

  it("doesn't tick Plugins for a plugin's own setting, only for which plugins are on (Adam, 2026-11-06)", async () => {
    // Removing a sample saves the word cloud the banner shows, under the admin's name.
    await save("plugins", { "plugin.wordcloud.onboarding_id": "" });
    expect(step(await view(), "plugins").done).toBe(false);
  });

  it("ticks the banner, the logo, Appearance, Copy and Plugins from what an admin saves", async () => {
    await save("identity", { "identity.banner_url": "https://example.test/banner.png", "identity.logo_url": "https://example.test/logo.png" });
    await save("theme", { "nav.layout": "top_tabs" });
    await save("copy", { "copy.resident_noun": "member" });
    await save("plugins", { "plugin.feedback.enabled": "true" });
    const body = await view();
    for (const id of ["banner", "logo", "theme", "copy", "plugins"]) expect(step(body, id).done, id).toBe(true);
    // The card's four are the checklist's.
    expect(body.steps.map((s) => s.done)).toEqual([true, true, true, true]);
  });

  it("Email needs only the sender's name", async () => {
    await save("email", { "email.from_name": "", "email.postal_address": "" });
    expect(step(await view(), "email").done).toBe(false);
    await save("email", { "email.from_name": "Card Hub" });
    expect(step(await view(), "email").done).toBe(true);
  });

  it("the save is in the admin log, by section and field, without the value", async () => {
    const log = await call("GET", "/admin/hub/admin-log", HOST, undefined, token);
    const row = (log.body.entries as Array<{ action: string; after: { section?: string }; actor_email: string }>).find(
      (e) => e.action === "settings.save" && e.after?.section === "legal",
    );
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

    const handover = await setAdmins(SLUG, { admins: [ADMIN, LATER] });
    expect(handover.status, JSON.stringify(handover.body)).toBe(200);
    const later = await mintSession(SLUG, LATER);
    const res = await call("GET", "/admin/hub/setup-card", HOST, undefined, later);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.dismissed).toBe(false);
    expect(step(res.body, "second_admin")).toMatchObject({ done: true, skipped: false, can_skip: false });
  });
});
