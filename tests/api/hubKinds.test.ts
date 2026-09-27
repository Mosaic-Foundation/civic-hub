// Hub kinds and the jurisdiction code on published records (2026-09-27,
// Adam).
//
//   - A place hub still needs a jurisdiction (the default kind is place).
//   - An `organization` hub with no jurisdiction works end to end: created
//     with no code, name or governing body; no sample content fits it; its
//     documents name no place and no government; its sign-up config says
//     organization; a process it creates is stamped "local", publishes with no
//     location, and its manifest names no jurisdiction.
//   - An `issue` hub linked to a state gets the state's code (`us-va`) and
//     still reads as a campaign, not as the state's government.
//   - A second hub's new process carries its OWN code, not the deployment's
//     CIVIC_JURISDICTION (CI and the local launch configs set it to Floyd's,
//     as production had it), and a hub without a code publishes no place.
//
// Needs the console on console.localhost, the local stack, and the
// jurisdiction list loaded (CI loads it; locally `scripts/load-jurisdictions.ts`).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";

type Row = Record<string, any>;
const run = Date.now().toString(36);
const ORG = `kind-org-${run}`;
const ISSUE = `kind-iss-${run}`;
const ADMIN = `kinds-${run}@example.test`;
const host = (slug: string) => `${slug}.localhost`;
const created: string[] = [];
let cookie = "";

async function stepCode(): Promise<string> {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantCode("step_up", code);
  return code;
}

async function create(body: Record<string, unknown>) {
  const res = await consoleCall("POST", "/control/hubs", {
    cookie,
    body: { name: `Kinds ${body.slug}`, hostname: `${body.slug}.localhost`, admin_email: ADMIN, ...body },
  });
  if (res.status === 201) created.push(String(body.slug));
  return res;
}

/** An admin creates and activates a vote on `hostName`; returns the process id. */
async function newVote(hostName: string, token: string, title: string): Promise<string> {
  const res = await call(
    "POST",
    "/process",
    hostName,
    { definition: { type: "civic.vote", version: "0.1" }, title, description: title, state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" } },
    token,
  );
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  const id = (res.body.id ?? res.body.process?.id) as string;
  const act = await call("POST", `/process/${id}/action`, hostName, { type: "process.activate", payload: {} }, token);
  expect(act.status, JSON.stringify(act.body).slice(0, 300)).toBe(200);
  return id;
}

beforeAll(async () => {
  cookie = await mintConsoleSession();
  const list = (await localRest("jurisdictions?select=ocd_id&ocd_id=eq.ocd-division/country:us/state:va")) as Row[];
  if (list.length === 0) throw new Error("hubKinds.test: load the jurisdiction list first (scripts/load-jurisdictions.ts).");
});

afterAll(async () => {
  for (const id of created) {
    await consoleCall("POST", `/control/hubs/${id}/archive`, { cookie, body: { step_up_code: await stepCode() } });
  }
});

describe("a place hub", () => {
  it("still needs a jurisdiction, whether its kind is named or left to the default", async () => {
    for (const extra of [{}, { hub_kind: "place" }]) {
      const res = await create({ slug: `kind-pl-${run}`, ...extra });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/A place hub needs its jurisdiction/);
    }
  });
});

describe("an organization hub with no jurisdiction", () => {
  let body: Row = {};

  beforeAll(async () => {
    const res = await create({ slug: ORG, hub_kind: "organization", sample_content: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    body = res.body;
  });

  it("has no place: no OCD id, name, code, type or governing body, and no sample content fits it", async () => {
    expect(body.config).toMatchObject({
      hub_kind: "organization",
      jurisdiction_ocd_id: null,
      jurisdiction_custom: false,
      jurisdiction_name: null,
      jurisdiction_code: null,
      jurisdiction_type: null,
      governing_body: "",
    });
    expect(body.sample_content.created).toEqual([]);
    const procs = (await localRest(`processes?select=id&hub_id=eq.${ORG}`)) as Row[];
    expect(procs).toHaveLength(0);
  });

  it("refuses a jurisdiction type or a governing body", async () => {
    const t = await create({ slug: `kind-ox-${run}`, hub_kind: "organization", jurisdiction_type: "town" });
    expect(t.status).toBe(400);
    const g = await create({ slug: `kind-oy-${run}`, hub_kind: "organization", governing_body: "Board" });
    expect(g.status).toBe(400);
  });

  it("serves, says what it is, and its documents name no place or government", async () => {
    const cfg = await call("GET", "/hub-config", host(ORG));
    expect(cfg.status).toBe(200);
    expect(cfg.body.settings["identity.hub_kind"]).toBe("organization");
    expect(cfg.body.hub.jurisdiction_code).toBeNull();
    const docs = await call("GET", "/hub-config/documents", host(ORG));
    expect(docs.status).toBe(200);
    for (const [key, text] of Object.entries(docs.body.documents as Record<string, string>)) {
      expect(text, key).not.toMatch(/\{(PLACE|STATE|JURISDICTION|GOVERNING_BODY)\}|\{\{[#^/]?place\}\}/);
      expect(text, key).not.toMatch(/resident of|residents of|local government/);
    }
    expect(docs.body.documents["legal.terms"]).toContain("You may create an account if you agree to these Terms");
  });

  it("publishes a process with no place, and a manifest with no jurisdiction", async () => {
    const token = await mintSession(ORG, ADMIN);
    const id = await newVote(host(ORG), token, `Org vote ${run}`);
    const [p] = (await localRest(`processes?select=jurisdiction&id=eq.${id}`)) as Row[];
    expect(p.jurisdiction).toBe("local");
    const events = (await localRest(`events?select=jurisdiction&process_id=eq.${id}`)) as Row[];
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.jurisdiction === "local" || e.jurisdiction === null)).toBe(true);

    const wire = await call("GET", "/events?page=true", host(ORG));
    expect(wire.status).toBe(200);
    const items = (wire.body.orderedItems ?? []) as Row[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((a) => "location" in a)).toBe(false);
    expect(JSON.stringify(items)).not.toContain("us-va-floyd");

    const manifest = await call("GET", "/.well-known/civic.json", host(ORG));
    expect(manifest.status).toBe(200);
    expect(manifest.body.jurisdictions).toBeUndefined();
  });
});

describe("an issue hub linked to a state", () => {
  it("gets the state's code, and still reads as a campaign", async () => {
    const res = await create({ slug: ISSUE, hub_kind: "issue", jurisdiction_ocd_id: "ocd-division/country:us/state:va" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.config).toMatchObject({
      hub_kind: "issue",
      jurisdiction_ocd_id: "ocd-division/country:us/state:va",
      jurisdiction_code: "us-va",
      jurisdiction_name: "Virginia",
      governing_body: "",
    });
    const docs = await call("GET", "/hub-config/documents", host(ISSUE));
    expect(docs.body.documents["legal.code_of_conduct"]).not.toMatch(/residents of|local government/);

    const token = await mintSession(ISSUE, ADMIN);
    const id = await newVote(host(ISSUE), token, `Issue vote ${run}`);
    const [p] = (await localRest(`processes?select=jurisdiction&id=eq.${id}`)) as Row[];
    expect(p.jurisdiction).toBe("us-va");
  });

  it("may drop its related place; a place hub may not", async () => {
    const drop = await consoleCall("PATCH", `/control/hubs/${ISSUE}`, {
      cookie,
      body: { jurisdiction_ocd_id: null, jurisdiction_custom: false, jurisdiction_name: "" },
    });
    expect(drop.status, JSON.stringify(drop.body)).toBe(200);
    expect(drop.body.config).toMatchObject({ jurisdiction_ocd_id: null, jurisdiction_name: null });
    const toPlace = await consoleCall("PATCH", `/control/hubs/${ISSUE}`, { cookie, body: { hub_kind: "place" } });
    expect(toPlace.status).toBe(400);
  });
});

describe("the jurisdiction on a new process", () => {
  it("is the hub's own code on a second hub, never the deployment's CIVIC_JURISDICTION", async () => {
    const athens = (await localRest("hubs?select=jurisdiction_code&id=eq.athens")) as Row[];
    const own = athens[0].jurisdiction_code as string;
    expect(own).toBeTruthy();
    expect(own).not.toBe("us-va-floyd");
    const token = await mintSession("athens", "admin+athens@example.test");
    const id = await newVote("athens.localhost", token, `Athens code ${run}`);
    const [p] = (await localRest(`processes?select=jurisdiction&id=eq.${id}`)) as Row[];
    expect(p.jurisdiction).toBe(own);
    const events = (await localRest(`events?select=jurisdiction&process_id=eq.${id}`)) as Row[];
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.jurisdiction === own)).toBe(true);
  });
});
