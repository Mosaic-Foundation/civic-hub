// The Civic Process Descriptor (§12.1; Architecture 2, ADR-009): GET
// /process/:id answers the UI read model as before, and the descriptor when
// asked for JSON-LD, as a consumer dereferencing an activity's `context` does.
// The descriptor's id and creator are the wire's, for each kind of caller; a
// process past its deadline reads closed in both, and reading writes nothing.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    // The declared disclosure policy (Architecture 3): a ballot's anonymity
    // is the vote's policy, not the reader's sign-in state.
    expect(d.disclosure_policy).toBe("anonymous");
    // Nothing the hub does not have (spec-only fields wait; results wait for A3).
    // No type declares eligibility stricter than the hub's rule (Architecture 4,
    // ADR-011), so none is served: the descriptor carries it only when declared.
    for (const absent of ["lifecycle_profile", "participation_mode", "aggregation_method", "result", "eligibility_requirements"]) {
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

describe("follow-ups reach the source's descriptor (Architecture 3)", () => {
  // Rows are written straight into the local stack, as hubCreatedReads does:
  // the test is about what the descriptor then serves.
  const briefId = `proc_fud${run.toString(36)}b`;
  const continuerId = `proc_fud${run.toString(36)}c`;
  const linkId = `plink_fud${run.toString(36)}`;

  beforeAll(async () => {
    await localRest("processes", {
      method: "POST",
      body: JSON.stringify({
        id: briefId,
        hub_id: "athens",
        type: "civic.brief",
        status: "active",
        title: `Brief of descriptor vote ${run}`,
        description: "",
        state: {
          source_process_id: voteId,
          source_process_type: "civic.vote",
          publication_status: "published",
          generated_at: new Date().toISOString(),
          published_at: new Date().toISOString(),
          content: { title: `Brief of descriptor vote ${run}`, headline: "", summary: "", sections: [], comments: [] },
          delivered_to: [],
          recipients: [],
        },
      }),
    });
    await localRest("processes", {
      method: "POST",
      body: JSON.stringify({
        id: continuerId,
        hub_id: "athens",
        type: "civic.vote",
        status: "active",
        title: `Continuation of descriptor vote ${run}`,
        description: "",
        state: { options: ["Yes", "No"] },
      }),
    });
    await localRest("process_links", {
      method: "POST",
      body: JSON.stringify({ id: linkId, hub_id: "athens", from_id: continuerId, to_id: voteId, relation: "continues" }),
    });
  });

  afterAll(async () => {
    await localRest(`process_links?id=eq.${linkId}`, { method: "DELETE" });
    await localRest(`processes?id=in.(${briefId},${continuerId})`, {
      method: "PATCH",
      body: JSON.stringify({ status: "archived" }),
    });
  });

  it("lists the published brief and a continuing process, as IRIs on the hub's origin", async () => {
    const d = (await get(`/process/${voteId}`, LD)).body;
    const iriOf = (id: string) => (d.id as string).replace(voteId, id);
    expect(d.follow_up_process_ids).toContain(iriOf(briefId));
    expect(d.follow_up_process_ids).toContain(iriOf(continuerId));
    for (const iri of d.follow_up_process_ids as string[]) {
      expect(iri).toMatch(/^https?:\/\/.+\/process\/proc_/);
    }
  });

  it("a link written through the API carries the target's IRI beside its id (to_iri)", async () => {
    const res = await call(
      "POST",
      `/process/${continuerId}/links`,
      ATHENS,
      { to_id: voteId, relation: "references" },
      admin,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [row] = (await localRest(
      `process_links?select=to_iri&from_id=eq.${continuerId}&to_id=eq.${voteId}&relation=eq.references`,
    )) as Array<{ to_iri: string | null }>;
    expect(row.to_iri).toMatch(new RegExp(`/process/${voteId}$`));
    await localRest(`process_links?from_id=eq.${continuerId}&relation=eq.references`, { method: "DELETE" });
  });

  it("withholds an unpublished brief from the public exactly as its page does", async () => {
    await localRest(`processes?id=eq.${briefId}`, {
      method: "PATCH",
      body: JSON.stringify({
        state: {
          source_process_id: voteId,
          source_process_type: "civic.vote",
          publication_status: "pending",
          content: { title: `Brief of descriptor vote ${run}`, headline: "", summary: "", sections: [], comments: [] },
          delivered_to: [],
          recipients: [],
        },
      }),
    });
    const d = (await get(`/process/${voteId}`, LD)).body;
    const briefIri = (d.id as string).replace(voteId, briefId);
    expect(d.follow_up_process_ids).not.toContain(briefIri);
  });
});

describe("participation on the descriptor (Architecture 3)", () => {
  let openVote = "";

  beforeAll(async () => {
    const created = await call(
      "POST",
      "/process",
      ATHENS,
      {
        definition: { type: "civic.vote", version: "0.1" },
        title: `Participation vote ${run}`,
        description: "A vote whose turnout the descriptor serves.",
        state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
      },
      admin,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    openVote = created.body.id ?? created.body.process?.id;
    const activated = await call("POST", `/process/${openVote}/action`, ATHENS, { type: "process.activate", payload: {} }, admin);
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);
  });

  it("a vote's turnout is a public count, live while the vote runs, and only a count", async () => {
    const before = (await get(`/process/${openVote}`, LD)).body;
    expect(before.participation).toEqual({ count: 0 });

    const voter = await mintSession("athens", `descriptor-voter-${run}@example.test`);
    const cast = await call("POST", `/process/${openVote}/action`, ATHENS, { type: "process.vote", payload: { option: "Yes" } }, voter);
    expect(cast.status, JSON.stringify(cast.body)).toBe(200);

    // The count is served to a signed-out reader; nothing else about the
    // ballot is (who voted and how stay off the descriptor and the wire).
    const after = (await get(`/process/${openVote}`, LD)).body;
    expect(after.participation).toEqual({ count: 1 });
    expect(JSON.stringify(after)).not.toContain("descriptor-voter");
  });
});

describe("GET /audiences/admins (Architecture 3)", () => {
  it("says what the audience is and who may read it, and serves no items", async () => {
    const res = await get("/audiences/admins");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/activity\+json/);
    expect(res.body.type).toBe("Collection");
    expect(res.body.id).toMatch(/\/audiences\/admins$/);
    expect(res.body.name).toBe("Hub administrators");
    expect(res.body.summary).toContain("administrators");
    // Listing members or counts would itself be a disclosure (§5.2).
    expect(res.body.items).toBeUndefined();
    expect(res.body.orderedItems).toBeUndefined();
    expect(res.body.totalItems).toBeUndefined();
  });

  it("an admin reader gets the same document — the audience never enumerates", async () => {
    const asAdmin = await get("/audiences/admins", {}, admin);
    const asPublic = await get("/audiences/admins");
    expect(asAdmin.body).toEqual(asPublic.body);
  });

  it("an unknown audience is not found", async () => {
    const res = await get(`/audiences/nope-${run}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
  });
});

describe("every type answers a descriptor", () => {
  it("a live process of each type is served as a civic:Process of its type", async () => {
    // Picked from the database, on either seeded hub, not from a public list:
    // other files archive records, and an admin publishes some types' first.
    const types = (await get("/.well-known/civic.json")).body.processes as string[];
    const served = new Set<string>();
    for (const [hub, host] of [["athens", ATHENS], ["floyd", "floyd.civic.social"]] as const) {
      for (const type of types) {
        if (served.has(type)) continue;
        const rows = (await localRest(
          `processes?select=id,state&hub_id=eq.${hub}&type=eq.${type}&status=not.in.(pending_review,archived,draft)&limit=20`,
        )) as Array<{ id: string; state: Record<string, unknown> | null }>;
        const row = rows.find((r) => {
          const s = r.state ?? {};
          if (s.publication_status !== undefined) return s.publication_status === "published";
          if (s.approval_status !== undefined) return s.approval_status === "published";
          return true;
        });
        if (!row) continue;
        const res = await call("GET", `/process/${row.id}`, host, undefined, undefined, undefined, LD);
        expect(res.status, `${type} on ${hub}: ${JSON.stringify(res.body)}`).toBe(200);
        expect(res.body.type).toBe("civic:Process");
        expect(res.body["civic:processType"]).toBe(type);
        expect(Array.isArray(res.body.actions)).toBe(true);
        served.add(type);
      }
    }
    expect(served.size, [...served].join(", ")).toBeGreaterThanOrEqual(4);
  });
});

describe("/.well-known/civic.json", () => {
  it("declares the space DID's custody and the assurance level once set, and omits them while not (Architecture 3, Q7)", async () => {
    const before = (await get("/.well-known/civic.json")).body;
    expect(before.space.custody).toBeUndefined();
    expect(before.space.assurance_level).toBeUndefined();

    await localRest(`hubs?id=eq.athens`, {
      method: "PATCH",
      body: JSON.stringify({
        custody_arrangement: "designated_custodian",
        custodian: "Mosaic Foundation",
        assurance_level: "email",
      }),
    });
    try {
      const after = (await get("/.well-known/civic.json")).body;
      expect(after.space.custody).toEqual({
        arrangement: "designated_custodian",
        custodian: "Mosaic Foundation",
      });
      expect(after.space.assurance_level).toBe("email");
    } finally {
      await localRest(`hubs?id=eq.athens`, {
        method: "PATCH",
        body: JSON.stringify({ custody_arrangement: null, custodian: null, assurance_level: null }),
      });
    }
  });

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
