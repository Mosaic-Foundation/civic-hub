// The Civic Process Descriptor (§12.1; Architecture 2, ADR-009): GET
// /process/:id answers the UI read model as before, and the descriptor when
// asked for JSON-LD, as a consumer dereferencing an activity's `context` does.
// The descriptor's id and creator are the wire's, for each kind of caller; a
// process past its deadline reads closed in both, and reading writes nothing.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";

const ATHENS = "athens.localhost";
const LD = { Accept: 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"' };
const AS = { Accept: "application/activity+json" };
const run = Date.now();

let admin = "";
let member = "";
let voteId = "";

async function get(path: string, headers: Record<string, string> = {}, token?: string) {
  return call("GET", path, ATHENS, undefined, token, undefined, headers);
}

/** The process's created activity, as GET /events serves it to this caller. */
async function createdActivity(id: string, token?: string): Promise<Record<string, any>> {
  const res = await call("GET", `/events?context=${id}&page=true&limit=50`, ATHENS, undefined, token);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const items = (res.body.orderedItems ?? []) as Array<Record<string, any>>;
  const created = items.filter((a) => a.type === "Create" && a.object?.type === "civic:Process");
  expect(created.length, "one created activity").toBeGreaterThanOrEqual(1);
  return created[created.length - 1];
}

beforeAll(async () => {
  admin = await mintSession("athens", "admin+athens@example.test");
  member = await mintSession("athens", `descriptor-member-${run}@example.test`);
  const created = await call(
    "POST",
    "/process",
    ATHENS,
    {
      definition: { type: "civic.vote", version: "0.1" },
      title: `Descriptor vote ${run}`,
      description: "A vote the descriptor tests read.",
      state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
    },
    admin,
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  voteId = created.body.id ?? created.body.process?.id;
  const activated = await call("POST", `/process/${voteId}/action`, ATHENS, { type: "process.activate", payload: {} }, admin);
  expect(activated.status, JSON.stringify(activated.body)).toBe(200);
});

describe("GET /process/:id content negotiation", () => {
  it("answers the UI read model as before without a JSON-LD Accept", async () => {
    const variants: Array<Record<string, string>> = [{}, { Accept: "application/json" }, { Accept: "*/*" }, { Accept: "text/html" }];
    for (const headers of variants) {
      const res = await get(`/process/${voteId}`, headers);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/^application\/json/);
      expect(res.body["@context"]).toBeUndefined();
      expect(res.body.type).toBe("civic.vote");
      expect(res.body.status).toBe("active");
    }
  });

  it("answers the descriptor for application/ld+json, built from the manifest and the process", async () => {
    const res = await get(`/process/${voteId}`, LD);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/ld\+json/);
    const d = res.body;
    expect(d["@context"]).toEqual(["https://www.w3.org/ns/activitystreams", "https://civic.social/ns/civic"]);
    expect(d.type).toBe("civic:Process");
    expect(d["civic:processType"]).toBe("civic.vote");
    expect(d.title).toBe(`Descriptor vote ${run}`);
    expect(d.status).toBe("active");
    expect(typeof d.ends_at).toBe("string");
    // The actions a resident may call, from the type's descriptor.
    expect(d.actions.map((a: { name: string }) => a.name).sort()).toEqual(["process.support", "process.unsupport", "process.vote"]);
    const vote = d.actions.find((a: { name: string }) => a.name === "process.vote");
    expect(vote.emits).toEqual(["civic.process.vote_submitted"]);
    expect(vote.input_schema.type).toBe("object");
    expect(d.endpoints.view).toMatch(new RegExp(`/process/${voteId}$`));
    expect(d.endpoints.action).toMatch(new RegExp(`/process/${voteId}/action$`));
    expect(d.follow_up_process_ids).toEqual([]);
    // Nothing the hub does not have (spec-only fields wait; results wait for A3).
    for (const absent of ["lifecycle_profile", "participation_mode", "disclosure_policy", "aggregation_method", "result"]) {
      expect(d[absent], absent).toBeUndefined();
    }
  });

  it("answers application/activity+json with the same document", async () => {
    const ld = await get(`/process/${voteId}`, LD);
    const as = await get(`/process/${voteId}`, AS);
    expect(as.status).toBe(200);
    expect(as.headers["content-type"]).toMatch(/^application\/activity\+json/);
    expect(as.body).toEqual(ld.body);
  });

  it("its id and creator are the wire's, for the public, a member and an admin", async () => {
    for (const token of [undefined, member, admin]) {
      const activity = await createdActivity(voteId, token);
      const d = (await get(`/process/${voteId}`, LD, token)).body;
      expect(d.id, "the process IRI its activities carry").toBe(activity.context.id);
      expect(d.created_by, "the creator as the wire shows this caller").toEqual(activity.actor);
    }
  });

  it("refuses what the page refuses, with the same error shape", async () => {
    const missing = await get(`/process/proc_nope_${run}`, LD);
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("not_found");
    const page = await get(`/process/proc_nope_${run}`);
    expect(missing.body).toEqual(page.body);
  });

  it("past the deadline, both read closed, and reading writes nothing", async () => {
    const [row] = (await localRest(`processes?select=state&id=eq.${voteId}`)) as Array<{ state: Record<string, unknown> }>;
    await localRest(`processes?id=eq.${voteId}`, {
      method: "PATCH",
      body: JSON.stringify({ state: { ...row.state, voting_closes_at: new Date(Date.now() - 60_000).toISOString() } }),
    });
    const before = ((await localRest(`events?select=id&process_id=eq.${voteId}`)) as unknown[]).length;
    expect((await get(`/process/${voteId}`, LD)).body.status).toBe("closed");
    expect((await get(`/process/${voteId}`)).body.status).toBe("closed");
    const [stored] = (await localRest(`processes?select=status&id=eq.${voteId}`)) as Array<{ status: string }>;
    expect(stored.status).toBe("active");
    expect(((await localRest(`events?select=id&process_id=eq.${voteId}`)) as unknown[]).length).toBe(before);
  });
});

describe("every type answers a descriptor", () => {
  it("each seeded process type on Athens is served as a civic:Process of its type", async () => {
    const list = (await get("/process")).body as Array<{ id: string; type: string }>;
    const byType = new Map<string, string>();
    for (const p of list) if (!byType.has(p.type)) byType.set(p.type, p.id);
    expect(byType.size).toBeGreaterThanOrEqual(5);
    for (const [type, id] of byType) {
      const res = await get(`/process/${id}`, LD);
      expect(res.status, `${type}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.type).toBe("civic:Process");
      expect(res.body["civic:processType"]).toBe(type);
      expect(Array.isArray(res.body.actions)).toBe(true);
    }
  });
});

describe("/.well-known/civic.json", () => {
  it("lists each type's public descriptor, with its display name", async () => {
    const res = await get("/.well-known/civic.json");
    expect(res.status).toBe(200);
    const types = res.body.process_types as Array<{ type: string; display: { label: string; plural: string }; actions: unknown[] }>;
    expect(types.map((t) => t.type)).toEqual(res.body.processes);
    const vote = types.find((t) => t.type === "civic.vote")!;
    expect(vote.display).toEqual({ label: "Vote", plural: "Votes" });
    for (const t of types) {
      expect(t.display.label, t.type).toBeTruthy();
      expect(Array.isArray(t.actions), t.type).toBe(true);
    }
  });
});
