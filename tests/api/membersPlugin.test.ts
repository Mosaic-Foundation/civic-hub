// The Members plugin (2026-10-14, Adam): the member count, the avatar stack
// and the Members page as a plugin, with a threshold below which residents
// see none of them, and an override that shows the page anyway. Share this
// hub's invites are the hub's own and stay on.
//
// On Athens (thousands of members on the seeded stack), whose settings are put
// back through the API afterwards (the API caches settings). Needs the local
// stack seeded as in CI and a server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession, storedSetting } from "../fixtures/adminSession.js";

const ATHENS = "athens.localhost";
const KEYS = ["plugin.members.enabled", "plugin.members.min_count", "plugin.members.page_before_threshold"];
const ABOVE_ANY_COUNT = "100000";

let admin = "";
let resident = "";
let before: Array<[string, string | undefined]> = [];

async function set(values: Record<string, string>) {
  const res = await call("PUT", "/admin/hub/settings", ATHENS, { section: "plugins", values }, admin);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

beforeAll(async () => {
  admin = await mintSession("athens", "admin+athens@example.test");
  const email = `members-plugin-${Date.now()}@example.test`;
  resident = await mintSession("athens", email);
  await localRest(`users?hub_id=eq.athens&email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ is_resident: true, full_name: "Members Plugin Resident" }),
  });
  before = await Promise.all(KEYS.map(async (k) => [k, await storedSetting("athens", k)] as [string, string | undefined]));
});

afterAll(async () => {
  await set({
    "plugin.members.enabled": before[0][1] ?? "true",
    "plugin.members.min_count": before[1][1] ?? "",
    "plugin.members.page_before_threshold": before[2][1] ?? "false",
  });
});

describe("the Members plugin", () => {
  it("at or past the threshold, everyone gets the count, the stack and the page", async () => {
    await set({ "plugin.members.min_count": "0", "plugin.members.page_before_threshold": "false" });
    const summary = await call("GET", "/members/summary", ATHENS);
    expect(summary.status).toBe(200);
    expect(summary.body.count).toBeGreaterThan(0);
    expect(summary.body.shown).toBe(true);
    expect((await call("GET", "/members", ATHENS, undefined, resident)).status).toBe(200);
    expect((await call("GET", "/hub-config", ATHENS)).body.members).toEqual({ page_shown: true });
  });

  it("below it, the server withholds the number and the stack, and the page is not there for residents", async () => {
    await set({ "plugin.members.min_count": ABOVE_ANY_COUNT });
    const anon = await call("GET", "/members/summary", ATHENS);
    expect(anon.status).toBe(200);
    expect(anon.body).toEqual({ count: null, stack: [], shown: false, page: false });
    const asResident = await call("GET", "/members/summary", ATHENS, undefined, resident);
    expect(asResident.body.count).toBeNull();
    expect((await call("GET", "/members", ATHENS, undefined, resident)).status).toBe(404);
    expect((await call("GET", "/hub-config", ATHENS)).body.members).toEqual({ page_shown: false });
  });

  it("an admin still sees the count, the threshold and the page", async () => {
    const summary = await call("GET", "/members/summary", ATHENS, undefined, admin);
    expect(summary.body.count).toBeGreaterThan(0);
    expect(summary.body).toMatchObject({ shown: false, threshold: Number(ABOVE_ANY_COUNT) });
    expect((await call("GET", "/members", ATHENS, undefined, admin)).status).toBe(200);
  });

  it("the override shows the page before the threshold; the count still waits", async () => {
    await set({ "plugin.members.page_before_threshold": "true" });
    expect((await call("GET", "/members", ATHENS, undefined, resident)).status).toBe(200);
    expect((await call("GET", "/members/summary", ATHENS)).body).toMatchObject({ count: null, page: true });
    expect((await call("GET", "/hub-config", ATHENS)).body.members).toEqual({ page_shown: true });
  });

  it("switched off, its routes answer 404 and the config drops it; invites stay the hub's", async () => {
    await set({ "plugin.members.enabled": "false" });
    expect((await call("GET", "/members/summary", ATHENS)).status).toBe(404);
    expect((await call("GET", "/members", ATHENS, undefined, resident)).status).toBe(404);
    expect((await call("GET", "/admin/hub/members", ATHENS, undefined, admin)).status).toBe(404);
    expect((await call("GET", "/hub-config", ATHENS)).body.members).toBeUndefined();
    // Invites are not the plugin's: a bad request is refused on its merits, not as missing.
    const invite = await call("POST", "/members/invites", ATHENS, { emails: "not an address" }, resident);
    expect(invite.status).toBe(400);
    await set({ "plugin.members.enabled": "true" });
  });
});
