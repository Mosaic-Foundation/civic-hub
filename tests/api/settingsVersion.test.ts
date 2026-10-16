// Settings reach every server at once (2026-10-16, the cleanup slice).
//
// Two API servers on one local stack stand in for two serverless instances:
// the server under test (CIVIC_API_BASE) and another (CIVIC_OTHER_API_BASE).
// CI runs both (:3000 and :3001) and gives each pass the other's address. Each
// server keeps a hub's settings in memory; before migration 20261018000000 a
// save cleared only the server that took it, and the other served the old
// value for up to a minute. Now every change bumps hubs.settings_version, the
// resolver reads the hub row on each request, and a stale copy is reloaded.
//
// Each check warms BOTH servers' caches first, then changes something, then
// reads at once on both, with no wait. What this does NOT prove: Vercel's
// instances are separate processes like these two, but this can't show how
// many there are or that a request never lands on one mid-deploy.
//
// Athens's settings and name are put back (afterAll). Skips without a second
// server.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, callAt } from "../fixtures/hostCall.js";
import { localRest, mintSession, storedSetting } from "../fixtures/adminSession.js";
import { API_BASE } from "../fixtures/helpers.js";

const OTHER = process.env.CIVIC_OTHER_API_BASE?.trim() ?? "";
const ATHENS = "athens.localhost";
const SERVERS = [API_BASE, OTHER];

let admin = "";
let layoutBefore: string | undefined;
let bannerBefore: string | undefined;
let nameBefore = "";

async function hubConfig(base: string) {
  const res = await callAt(base, "GET", "/hub-config", ATHENS);
  expect(res.status).toBe(200);
  return res.body as { hub: { name: string; mode: string }; settings: Record<string, string | undefined> };
}

async function version(): Promise<number> {
  const rows = (await localRest("hubs?id=eq.athens&select=settings_version")) as Array<{ settings_version: number }>;
  return Number(rows[0]!.settings_version);
}

describe.skipIf(!OTHER)("a change reaches the other server on its next request", () => {
  beforeAll(async () => {
    admin = await mintSession("athens", "admin+athens@example.test");
    layoutBefore = await storedSetting("athens", "nav.layout");
    bannerBefore = await storedSetting("athens", "copy.beta_banner");
    nameBefore = (await hubConfig(API_BASE)).hub.name;
    expect(nameBefore).toBeTruthy();
  });

  afterAll(async () => {
    await call("PUT", "/admin/hub/settings", ATHENS, { section: "theme", values: { "nav.layout": layoutBefore ?? "" } }, admin);
    if (bannerBefore === undefined) {
      await localRest("hub_settings?hub_id=eq.athens&key=eq.copy.beta_banner", { method: "DELETE" });
    } else {
      await localRest("hub_settings?hub_id=eq.athens&key=eq.copy.beta_banner", {
        method: "PATCH",
        body: JSON.stringify({ value: bannerBefore }),
      });
    }
    await localRest("hubs?id=eq.athens", { method: "PATCH", body: JSON.stringify({ name: nameBefore }) });
  });

  it("an admin's save on one server is served by the other at once", async () => {
    const next = layoutBefore === "sidebar" ? "top" : "sidebar";
    for (const base of SERVERS) await hubConfig(base);
    const v = await version();

    const saved = await call("PUT", "/admin/hub/settings", ATHENS, { section: "theme", values: { "nav.layout": next } }, admin);
    expect(saved.status).toBe(200);
    expect(await version()).toBeGreaterThan(v);

    for (const base of SERVERS) expect((await hubConfig(base)).settings["nav.layout"]).toBe(next);
  });

  it("a write that goes round the API (the console, a script, the SQL editor) reaches both", async () => {
    for (const base of SERVERS) await hubConfig(base);
    const text = `Banner ${Date.now()}`;
    await localRest("hub_settings?on_conflict=hub_id,key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ hub_id: "athens", key: "copy.beta_banner", value: text }),
    });
    for (const base of SERVERS) expect((await hubConfig(base)).settings["copy.beta_banner"]).toBe(text);
  });

  it("a change to the hub's own row (its name; the mode is the same row) reaches both", async () => {
    for (const base of SERVERS) await hubConfig(base);
    const v = await version();
    const renamed = `${nameBefore} ${Date.now()}`;
    await localRest("hubs?id=eq.athens", { method: "PATCH", body: JSON.stringify({ name: renamed }) });
    expect(await version()).toBeGreaterThan(v);
    for (const base of SERVERS) expect((await hubConfig(base)).hub.name).toBe(renamed);
  });

  it("a write that changes nothing leaves the version alone", async () => {
    const v = await version();
    await localRest("hubs?id=eq.athens", { method: "PATCH", body: JSON.stringify({ name: (await hubConfig(API_BASE)).hub.name }) });
    expect(await version()).toBe(v);
  });
});
