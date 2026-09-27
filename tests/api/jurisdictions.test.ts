// The jurisdiction reference list in the console (2026-09-27, Adam): the
// state list and the type-ahead, the slug suggestion's order, creating a hub
// from a listed jurisdiction or a custom one (never loose free text), several
// hubs on one jurisdiction shown as information, and editing a hub's
// jurisdiction with an audit row.
//
// Fixture rows are fictional (state "zz"), written as the owner, removed in
// afterAll. Needs the console on console.localhost (CI's env) and the local stack.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { auditFor, consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";

const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
{
  const host = new URL(DB_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`jurisdictions.test: refusing ${host}; local stack only.`);
}

const tag = randomBytes(3).toString("hex");
const BASE = `tv${tag}`; // the slug every candidate starts from
const Name = `Tv${tag}`;
const OCD = {
  state: "ocd-division/country:us/state:zz",
  town: `ocd-division/country:us/state:zz/place:${BASE}`,
  county: `ocd-division/country:us/state:zz/county:${BASE}`,
  north: `ocd-division/country:us/state:zz/place:north_${BASE}`,
};
const ROWS = [
  [OCD.state, "99", "zz", "state", "Zedland", "Zedland"],
  [OCD.town, `99${tag}1`, "zz", "town", `${Name} town`, `Town of ${Name}, Zedland`],
  [OCD.county, `99${tag}2`, "zz", "county", `${Name} County`, `${Name} County, Zedland`],
  [OCD.north, `99${tag}3`, "zz", "town", `North ${Name} town`, `Town of North ${Name}, Zedland`],
];

let db: pg.Client;
let cookie = "";
const created: string[] = [];

async function stepCode(): Promise<string> {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantCode("step_up", code);
  return code;
}

async function create(body: Record<string, unknown>) {
  const res = await consoleCall("POST", "/control/hubs", {
    cookie,
    body: { name: `Jurisdiction Test ${body.slug}`, hostname: `${body.slug}.localhost`, admin_email: `j-${tag}@example.test`, ...body },
  });
  if (res.status === 201) created.push(String(body.slug));
  return res;
}

async function suggest(name: string, type: string, state = "zz") {
  const res = await consoleCall("GET", `/control/slug-suggestion?${new URLSearchParams({ name, type, state })}`, { cookie });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { slug: string; hostname: string | null; passed_over: Array<{ slug: string; reason: string }> };
}

beforeAll(async () => {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  await db.query("delete from jurisdictions where ocd_id = $1", [OCD.state]).catch(() => undefined);
  for (const r of ROWS) {
    await db.query(
      "insert into jurisdictions (ocd_id, census_geoid, state, type, official_name, display_name) values ($1,$2,$3,$4,$5,$6) on conflict (ocd_id) do nothing",
      r,
    );
  }
  cookie = await mintConsoleSession();
});

afterAll(async () => {
  for (const id of created) {
    await consoleCall("POST", `/control/hubs/${id}/archive`, { cookie, body: { step_up_code: await stepCode() } });
  }
  await db.query("update hubs set jurisdiction_ocd_id = null where jurisdiction_ocd_id like 'ocd-division/country:us/state:zz%'");
  await db.query("delete from jurisdictions where state = 'zz'");
  await db.end();
});

describe("the reference list in the console", () => {
  it("serves the states and a type-ahead over one state's jurisdictions of one type", async () => {
    const states = await consoleCall("GET", "/control/jurisdictions/states", { cookie });
    expect(states.status).toBe(200);
    expect(states.body.states.map((s: { ocd_id: string }) => s.ocd_id)).toContain(OCD.state);

    const prefix = await consoleCall("GET", `/control/jurisdictions?state=zz&type=town&q=${Name.slice(0, 4)}`, { cookie });
    expect(prefix.status).toBe(200);
    const ids = prefix.body.matches.map((m: { ocd_id: string }) => m.ocd_id);
    // "Tv…" first (the name starts with it), then "North Tv…" (a later word does).
    expect(ids).toEqual([OCD.town, OCD.north]);
    expect(prefix.body.matches[0]).toMatchObject({ display_name: `Town of ${Name}, Zedland`, census_geoid: `99${tag}1`, hubs: [] });

    const counties = await consoleCall("GET", `/control/jurisdictions?state=zz&type=county&q=${Name}`, { cookie });
    expect(counties.body.matches.map((m: { ocd_id: string }) => m.ocd_id)).toEqual([OCD.county]);

    const bad = await consoleCall("GET", "/control/jurisdictions?state=zz&type=parish&q=x", { cookie });
    expect(bad.status).toBe(400);
  });

  it("is read-only to the service role", async () => {
    const { localRest } = await import("../fixtures/adminSession.js");
    await expect(
      localRest("jurisdictions", { method: "POST", body: JSON.stringify({ ocd_id: `${OCD.state}/place:nope`, census_geoid: "1", state: "zz", type: "town", official_name: "x", display_name: "x" }) }),
    ).rejects.toThrow();
  });
});

describe("the slug suggestion", () => {
  it("offers the plain name, then name + type, then name + state, then a number", async () => {
    expect((await suggest(`${Name} town`, "town")).slug).toBe(BASE);
    const a = await create({ slug: BASE, jurisdiction_ocd_id: OCD.town, jurisdiction_name: `Town of ${Name}, Zedland`, jurisdiction_type: "town" });
    expect(a.status, JSON.stringify(a.body)).toBe(201);

    const county = await suggest(`${Name} County`, "county");
    expect(county.slug).toBe(`${BASE}-county`);
    expect(county.passed_over).toEqual([{ slug: BASE, reason: "taken" }]);
    // With a platform domain (console.<domain>) the address comes too; on
    // console.localhost there is none, and the form leaves the hostname to the operator.
    if (county.hostname !== null) expect(county.hostname).toMatch(new RegExp(`^${BASE}-county\\.`));

    expect((await suggest(`${Name} town`, "town")).slug).toBe(`${BASE}-town`);
    expect((await create({ slug: `${BASE}-town`, jurisdiction_ocd_id: OCD.town, jurisdiction_type: "town" })).status).toBe(201);
    expect((await suggest(`${Name} town`, "town")).slug).toBe(`${BASE}-zz`);
    expect((await create({ slug: `${BASE}-zz`, jurisdiction_ocd_id: OCD.town, jurisdiction_type: "town" })).status).toBe(201);
    expect((await suggest(`${Name} town`, "town")).slug).toBe(`${BASE}-2`);
  });

  it("passes over a reserved name", async () => {
    const s = await suggest("Console town", "town");
    expect(s.passed_over[0]).toEqual({ slug: "console", reason: "reserved" });
    expect(s.slug).not.toBe("console");
  });
});

describe("creating a hub", () => {
  it("from the list: the OCD id, not custom; several hubs may serve one jurisdiction", async () => {
    const row = await db.query("select jurisdiction_ocd_id, jurisdiction_custom, jurisdiction_name, jurisdiction_code from hubs where id = $1", [BASE]);
    expect(row.rows[0]).toEqual({
      jurisdiction_ocd_id: OCD.town,
      jurisdiction_custom: false,
      jurisdiction_name: `Town of ${Name}, Zedland`,
      // Derived from the OCD id at creation: a town adds its type.
      jurisdiction_code: `us-zz-${BASE}-town`,
    });
    const m = await consoleCall("GET", `/control/jurisdictions?state=zz&type=town&q=${Name}`, { cookie });
    const served = m.body.matches.find((x: { ocd_id: string }) => x.ocd_id === OCD.town).hubs.map((h: { id: string }) => h.id).sort();
    expect(served).toEqual([BASE, `${BASE}-town`, `${BASE}-zz`].sort());
  });

  it("with the name of the list's jurisdiction when none is sent", async () => {
    const res = await create({ slug: `${BASE}-n`, jurisdiction_ocd_id: OCD.county, jurisdiction_type: "county" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.config).toMatchObject({
      jurisdiction_ocd_id: OCD.county,
      jurisdiction_custom: false,
      jurisdiction_code: `us-zz-${BASE}`,
      jurisdiction_name: `${Name} County, Zedland`,
      governing_body: "County Commission",
    });
  });

  it("custom: a typed name and no OCD id", async () => {
    const res = await create({ slug: `${BASE}-c`, jurisdiction_custom: true, jurisdiction_name: "The Northside neighbourhood", jurisdiction_type: "other" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.config).toMatchObject({
      jurisdiction_ocd_id: null,
      jurisdiction_custom: true,
      jurisdiction_name: "The Northside neighbourhood",
      jurisdiction_code: null,
    });
  });

  it("refuses loose free text, an unknown id, and custom with an id", async () => {
    const loose = await create({ slug: `${BASE}-x1`, jurisdiction_name: "Somewhere" });
    expect(loose.status).toBe(400);
    expect(loose.body.error).toMatch(/from the list, or mark it Other/);
    const unknown = await create({ slug: `${BASE}-x2`, jurisdiction_ocd_id: `${OCD.state}/place:nowhere_${tag}` });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatch(/not in the jurisdiction list/);
    const both = await create({ slug: `${BASE}-x3`, jurisdiction_ocd_id: OCD.town, jurisdiction_custom: true, jurisdiction_name: "x" });
    expect(both.status).toBe(400);
    const code = await create({ slug: `${BASE}-x4`, jurisdiction_ocd_id: OCD.town, jurisdiction_code: "us-zz-mine" });
    expect(code.status).toBe(400);
    expect(code.body.error).toMatch(/derived from the jurisdiction's OCD id/);
  });
});

describe("editing a hub's jurisdiction", () => {
  it("moves it to another listed jurisdiction, audited", async () => {
    const res = await consoleCall("PATCH", `/control/hubs/${BASE}`, {
      cookie,
      body: { jurisdiction_ocd_id: OCD.county, jurisdiction_name: `${Name} County, Zedland`, jurisdiction_type: "county" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.hub.jurisdiction_ocd_id).toBe(OCD.county);
    // Never recomputed: the code the hub has published stays.
    expect(res.body.hub.jurisdiction_code).toBe(`us-zz-${BASE}-town`);
    const typed = await consoleCall("PATCH", `/control/hubs/${BASE}`, { cookie, body: { jurisdiction_code: "us-zz-other" } });
    expect(typed.status).toBe(400);
    const audit = (await auditFor(BASE)).find((a) => a.action === "hub.update");
    expect(audit?.before).toMatchObject({ jurisdiction_ocd_id: OCD.town });
    expect(audit?.after).toMatchObject({ jurisdiction_ocd_id: OCD.county, jurisdiction_name: `${Name} County, Zedland` });
  });

  it("refuses custom while an OCD id stays, and accepts custom with the id cleared", async () => {
    const bad = await consoleCall("PATCH", `/control/hubs/${BASE}`, { cookie, body: { jurisdiction_custom: true } });
    expect(bad.status).toBe(400);
    const ok = await consoleCall("PATCH", `/control/hubs/${BASE}`, {
      cookie,
      body: { jurisdiction_custom: true, jurisdiction_ocd_id: null, jurisdiction_name: "Tv district" },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.config).toMatchObject({ jurisdiction_custom: true, jurisdiction_ocd_id: null });
  });
});
