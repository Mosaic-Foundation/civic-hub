// Wire identity across a hub move (Architecture-1, ADR-008).
//
// On a hub the console creates (Athens and Floyd are untouched): an admin
// opens a vote, the console moves the hub to a new hostname, and then
//   - every activity it published is served from the new address with the
//     same bytes, ids still on the old address;
//   - the move itself is a Move activity, minted at the old address;
//   - a new activity is minted at the new address, while its process keeps
//     the IRI it was created with;
//   - the old address answers civic.json with a moved tombstone naming the
//     Move, keeps serving the DID document its DID names, and its redirects
//     carry a Link to the tombstone;
//   - the new address serves no DID document (its DID names the old one).
//
// Needs the console's env, like tests/api/control.test.ts. The hub is
// archived in afterAll.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { mintSession } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";

const run = Date.now().toString(36);
const SLUG = `wi-${run}`;
const OLD = `wi-${run}.localhost`;
const NEW = `wi-new-${run}.localhost`;
const ADMIN = `wi-admin-${run}@example.test`;
const MOVED_REL = "https://www.civic.social/ns/civic-hub#moved";

let cookie = "";
let token = "";
let voteId = "";
let before: Array<Record<string, any>> = [];

async function stepCode(): Promise<string> {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantCode("step_up", code);
  return code;
}

/** Every activity the hub serves an admin, oldest first. */
async function activities(host: string): Promise<Array<Record<string, any>>> {
  const out: Array<Record<string, any>> = [];
  let path: string | null = "/events?page=true&limit=200";
  while (path) {
    const res = await call("GET", path, host, undefined, token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    out.push(...res.body.orderedItems);
    path = res.body.next ? new URL(res.body.next).pathname + new URL(res.body.next).search : null;
  }
  return out.reverse();
}

async function openVote(title: string): Promise<string> {
  const made = await call("POST", "/process", OLD, {
    definition: { type: "civic.vote", version: "0.1" },
    title,
    description: "A vote for the wire identity test.",
    state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
  }, token);
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  return made.body.id;
}

beforeAll(async () => {
  cookie = await mintConsoleSession();
  const res = await consoleCall("POST", "/control/hubs", {
    cookie,
    body: { slug: SLUG, name: "Wire Identity Hub", hostname: OLD, admin_email: ADMIN, hub_kind: "organization" },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  token = await mintSession(SLUG, ADMIN);
  voteId = await openVote(`Before the move ${run}`);
  before = await activities(OLD);
  expect(before.length).toBeGreaterThan(0);
});

afterAll(async () => {
  await consoleCall("POST", `/control/hubs/${SLUG}/archive`, { cookie, body: { step_up_code: await stepCode() } });
});

describe("before the move", () => {
  it("serves the hub's DID document on the hostname its DID names", async () => {
    const res = await call("GET", "/.well-known/did.json", OLD);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/did+json");
    expect(res.body.id).toBe(`did:web:${OLD}`);
    expect(res.body["@context"]).toEqual(["https://www.w3.org/ns/did/v1"]);
    expect(res.body.verificationMethod).toBeUndefined();
    const endpoints = res.body.service.map((s: { serviceEndpoint: string }) => s.serviceEndpoint);
    expect(endpoints[0]).toMatch(new RegExp(`^https?://${OLD}(:\\d+)?/\\.well-known/civic\\.json$`));
    expect(endpoints[1]).toMatch(new RegExp(`^https?://${OLD}(:\\d+)?/events$`));
  });

  it("declares the software namespace on activities it stores now", async () => {
    const res = await call("GET", "/ns", OLD);
    expect(res.status).toBe(200);
    const created = before.find((a) => a.type === "Create");
    expect(created).toBeDefined();
    const hubEntry = (created!["@context"] as unknown[]).find((c) => typeof c === "object");
    if (hubEntry) expect(hubEntry).toEqual({ hub: "https://www.civic.social/ns/civic-hub#" });
  });
});

describe("after the console moves the hub", () => {
  let after: Array<Record<string, any>> = [];

  beforeAll(async () => {
    const res = await consoleCall("PATCH", `/control/hubs/${SLUG}`, {
      cookie,
      body: { hostname: NEW, step_up_code: await stepCode() },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.hub.hostname).toBe(NEW);
    after = await activities(NEW);
  });

  it("serves everything it published with the same bytes, from the new address", () => {
    const byId = new Map(after.map((a) => [a.id, JSON.stringify(a)]));
    for (const a of before) {
      expect(a.id).toContain(OLD);
      expect(byId.get(a.id), a.id).toBe(JSON.stringify(a));
    }
  });

  it("publishes a Move, minted at the old address", () => {
    const move = after.find((a) => a.type === "Move");
    expect(move).toBeDefined();
    expect(move!.id).toContain(`//${OLD}`);
    expect(move!.actor).toBe(`did:web:${OLD}`);
    expect(move!.object).toBe(`did:web:${OLD}`);
    expect(move!.generator.id).toBe(`did:web:${OLD}`);
    expect(move!.origin).toMatchObject({ type: "Link" });
    expect(move!.origin.href).toContain(`//${OLD}`);
    expect(move!.target.href).toContain(`//${NEW}`);
    expect(move!.to).toEqual(["https://www.w3.org/ns/activitystreams#Public"]);
  });

  it("mints a new activity at the new address; its process keeps its first IRI", async () => {
    const res = await call("POST", `/process/${voteId}/action`, NEW, { type: "process.activate", payload: {} }, token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const latest = (await activities(NEW)).filter((a) => !before.some((b) => b.id === a.id) && a.type !== "Move");
    expect(latest.length).toBeGreaterThan(0);
    for (const a of latest) {
      expect(a.id).toContain(`//${NEW}`);
      expect(a.context.id).toContain(`//${OLD}`);
    }
  });

  it("the old address answers civic.json with a tombstone naming the Move", async () => {
    const res = await call("GET", "/.well-known/civic.json", OLD);
    expect(res.status).toBe(200);
    const move = after.find((a) => a.type === "Move")!;
    expect(res.body.moved).toMatchObject({ space: `did:web:${OLD}`, activity: move.id });
    expect(res.body.moved.to).toMatch(new RegExp(`//${NEW}(:\\d+)?/\\.well-known/civic\\.json$`));
  });

  it("the old address still serves the DID document, pointing at the new one", async () => {
    const res = await call("GET", "/.well-known/did.json", OLD);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(`did:web:${OLD}`);
    for (const s of res.body.service) expect(s.serviceEndpoint).toContain(`//${NEW}`);
  });

  it("an old id still resolves: a redirect, with a Link to the tombstone", async () => {
    const path = new URL(before[0].id).pathname;
    const res = await call("GET", path, OLD);
    expect(res.status).toBe(301);
    expect(res.headers.location).toContain(`//${NEW}`);
    expect(res.headers.link).toContain(`rel="${MOVED_REL}"`);
    const there = await call("GET", path, NEW, undefined, token);
    expect(there.status).toBe(200);
    expect(there.body.id).toBe(before[0].id);
  });

  it("the new address serves no DID document: the hub's DID names the old one", async () => {
    const res = await call("GET", "/.well-known/did.json", NEW);
    expect(res.status).toBe(404);
  });
});
