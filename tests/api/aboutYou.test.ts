// About you (districts and demographics, 2026-11-16), against a running hub
// with CIVIC_FAKE_ADAPTERS=on (the geocoder is the fake: no network).
// A member reads and writes only their own answers; the first read or save
// records that they were asked; the address lookup answers with the hub's
// own district and keeps nothing. Needs the local stack and a server
// (CIVIC_API_BASE).

import { beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { createHub } from "../fixtures/operator.js";

const run = Date.now().toString(36);
const HUB = `about-${run}`;
const HOST = `${HUB}.localhost`;
const ADMIN = `about-admin-${run}@example.test`;
const DISTRICTS = [
  { id: "courthouse", name: "Courthouse" },
  { id: "little-river", name: "Little River" },
];

let admin = "";
let member = "";
let other = "";

beforeAll(async () => {
  const res = await createHub({ slug: HUB, name: `About ${run}`, hostname: HOST, admin_email: ADMIN, hub_kind: "organization", mode: "beta" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  admin = await mintSession(HUB, ADMIN);
  member = await mintSession(HUB, `about-member-${run}@example.test`);
  other = await mintSession(HUB, `about-other-${run}@example.test`);
  const saved = await call(
    "PUT",
    "/admin/hub/settings",
    HOST,
    { section: "districts", values: { "about.districts": DISTRICTS, "about.district_term": "District" } },
    admin,
  );
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
});

describe("the hub's district settings", () => {
  it("are public, for the card and the results tables", async () => {
    const cfg = await call("GET", "/hub-config", HOST);
    expect(cfg.status).toBe(200);
    const settings = (cfg.body as { settings?: Record<string, string> }).settings ?? {};
    expect(JSON.parse(settings["about.districts"] ?? "[]")).toEqual(DISTRICTS);
    expect(settings["about.district_term"]).toBe("District");
  });

  it("refuses a district list with a repeated name", async () => {
    const bad = await call(
      "PUT",
      "/admin/hub/settings",
      HOST,
      { section: "districts", values: { "about.districts": [...DISTRICTS, { id: "x", name: "courthouse" }] } },
      admin,
    );
    expect(bad.status).toBe(400);
  });
});

describe("a member's own answers", () => {
  it("start empty and not asked", async () => {
    const res = await call("GET", "/user/about", HOST, undefined, member);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ asked: false, answers: { district_id: null, birth_year: null, race: [], asked_at: null } });
  });

  it("closing the card records the ask, once", async () => {
    const first = await call("POST", "/user/about/asked", HOST, undefined, other);
    expect(first.status).toBe(200);
    const at = (first.body as { answers: { asked_at: string } }).answers.asked_at;
    expect(at).toBeTruthy();
    const again = await call("POST", "/user/about/asked", HOST, undefined, other);
    expect(Date.parse((again.body as { answers: { asked_at: string } }).answers.asked_at)).toBe(Date.parse(at));
    expect(((await call("GET", "/user/about", HOST, undefined, other)).body as { asked: boolean }).asked).toBe(true);
  });

  it("saves a district and a year, and 'Prefer not to say'", async () => {
    const res = await call("PUT", "/user/about", HOST, { district_id: "little-river", birth_year: 1970 }, member);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ answers: { district_id: "little-river", birth_year: 1970, declined: [] } });
    const declined = await call("PUT", "/user/about", HOST, { birth_year: "prefer_not" }, member);
    expect(declined.body).toMatchObject({ answers: { district_id: "little-river", birth_year: null, declined: ["birth_year"] } });
    expect(((await call("GET", "/user/about", HOST, undefined, member)).body as { asked: boolean }).asked).toBe(true);
  });

  it("refuses a district not on the list, a question the hub doesn't ask, and a bad year", async () => {
    expect((await call("PUT", "/user/about", HOST, { district_id: "elsewhere" }, member)).status).toBe(400);
    expect((await call("PUT", "/user/about", HOST, { race: ["white"] }, member)).status).toBe(400);
    expect((await call("PUT", "/user/about", HOST, { birth_year: 1800 }, member)).status).toBe(400);
  });

  it("is the member's own: another member never sees it, and signed out is refused", async () => {
    const theirs = await call("GET", "/user/about", HOST, undefined, other);
    expect((theirs.body as { answers: { district_id: string | null } }).answers.district_id).toBeNull();
    expect((await call("GET", "/user/about", HOST)).status).toBe(401);
    expect((await call("PUT", "/user/about", HOST, { district_id: "courthouse" })).status).toBe(401);
  });

  it("goes when the account is deleted", async () => {
    const gone = await mintSession(HUB, `about-gone-${run}@example.test`);
    await call("PUT", "/user/about", HOST, { district_id: "courthouse" }, gone);
    const before = (await localRest(`member_about?hub_id=eq.${HUB}&district_id=eq.courthouse&select=user_id`)) as unknown[];
    expect(before.length).toBe(1);
    expect((await call("DELETE", "/auth/me", HOST, undefined, gone)).status).toBeLessThan(300);
    const after = (await localRest(`member_about?hub_id=eq.${HUB}&district_id=eq.courthouse&select=user_id`)) as unknown[];
    expect(after.length).toBe(0);
  });
});

describe("finding a district by address", () => {
  it("answers with the hub's district for the Census name, loosely matched", async () => {
    const res = await call("POST", "/user/about/district-lookup", HOST, { address: "1 Main St in Court House district" }, member);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ match: { id: "courthouse", name: "Courthouse" }, reason: null });
  });

  it("says so when the address is not found, or is in no listed district", async () => {
    expect((await call("POST", "/user/about/district-lookup", HOST, { address: "1 Nowhere Lane" }, member)).body).toEqual({
      match: null,
      reason: "not_found",
    });
    expect((await call("POST", "/user/about/district-lookup", HOST, { address: "2 Elm St in Alum Ridge district" }, member)).body).toEqual({
      match: null,
      reason: "no_match",
    });
  });

  it("refuses a too-short address and a signed-out caller", async () => {
    expect((await call("POST", "/user/about/district-lookup", HOST, { address: "x" }, member)).status).toBe(400);
    expect((await call("POST", "/user/about/district-lookup", HOST, { address: "1 Main St" })).status).toBe(401);
  });
});
