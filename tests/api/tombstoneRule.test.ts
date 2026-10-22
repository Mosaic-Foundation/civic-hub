// Deletions are announced (Architecture 3, ADR-010; Adam, 2026-10-21, Q5).
//
// A published activity is never removed without a trace: an admin archiving a
// PUBLISHED process writes a public Delete in the same transaction, each of
// the process's activity ids keeps answering with a Tombstone (the id, the
// removal time, nothing else), and a restore undoes the Delete by its id. A
// process that was never published (pending review) keeps its silent 404 —
// its existence was never on the wire. events.is_sample is computed by
// trigger and never accepted from the inserter (20261022000000).
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";

const ATHENS = "athens.localhost";
const run = randomBytes(4).toString("hex");

let admin = "";
let voteId = "";
/** The vote's public activity ids, captured before the archive. */
let activityIds: string[] = [];
let deleteActivityId = "";

async function publicActivities(processId: string): Promise<Array<Record<string, any>>> {
  const res = await call("GET", `/events?context=${processId}&page=true&limit=50`, ATHENS);
  expect(res.status).toBe(200);
  return (res.body.orderedItems ?? []) as Array<Record<string, any>>;
}

beforeAll(async () => {
  admin = await mintSession("athens", "admin+athens@example.test");
  const created = await call(
    "POST",
    "/process",
    ATHENS,
    {
      definition: { type: "civic.vote", version: "0.1" },
      title: `Tombstone vote ${run}`,
      description: "A vote the removal tests archive.",
      state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
    },
    admin,
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  voteId = created.body.id ?? created.body.process?.id;
  const activated = await call("POST", `/process/${voteId}/action`, ATHENS, { type: "process.activate", payload: {} }, admin);
  expect(activated.status).toBe(200);
  const items = await publicActivities(voteId);
  expect(items.length).toBeGreaterThan(0);
  activityIds = items.map((a) => String(a.id).split("/activities/")[1]);
});

afterAll(async () => {
  // The run's rows out of the public list (the restored vote and the planted
  // sample; archived rows and samples of archived processes stop serving).
  await localRest(`processes?id=in.(${voteId},proc_tomb${run}s)`, {
    method: "PATCH",
    body: JSON.stringify({ status: "archived" }),
  }).catch(() => undefined);
});

describe("an admin taking a published process down", () => {
  it("writes a public Delete of the process, in the stream and at the context lookup", async () => {
    const archived = await call("POST", `/admin/processes/${voteId}/archive`, ATHENS, { reason: "Removal test" }, admin);
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);

    // The context lookup serves the removal and nothing else.
    const items = await publicActivities(voteId);
    expect(items.length).toBe(1);
    expect(items[0].type).toBe("Delete");
    expect((items[0].object as { id?: string }).id).toMatch(new RegExp(`/process/${voteId}$`));
    deleteActivityId = String(items[0].id);
    // The reason and the admin stay in the moderation log, not on the wire.
    expect(JSON.stringify(items[0])).not.toContain("Removal test");

    // The unfiltered stream carries it too, for a signed-out reader.
    const page = await call("GET", `/events?page=true&limit=50`, ATHENS);
    const ids = (page.body.orderedItems as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toContain(deleteActivityId);
  });

  it("each of its activity ids answers a Tombstone — the id, the removal time, nothing else", async () => {
    for (const id of activityIds) {
      const res = await call("GET", `/activities/${id}`, ATHENS);
      expect(res.status, id).toBe(410);
      expect(res.body.type).toBe("Tombstone");
      expect(res.body.id).toMatch(new RegExp(`/activities/${id}$`));
      expect(typeof res.body.deleted).toBe("string");
      expect(Object.keys(res.body).sort()).toEqual(["@context", "deleted", "id", "type"]);
    }
  });

  it("the Delete's own id dereferences while the process stays down", async () => {
    const id = deleteActivityId.split("/activities/")[1];
    const res = await call("GET", `/activities/${id}`, ATHENS);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("Delete");
  });

  it("a restore undoes the Delete by its id, and the history serves again", async () => {
    const restored = await call("POST", `/admin/processes/${voteId}/restore`, ATHENS, {}, admin);
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);

    const items = await publicActivities(voteId);
    const undo = items.find((a) => a.type === "Undo");
    expect(undo, "an Undo of the Delete").toBeTruthy();
    expect(undo!.object).toEqual({ type: "Delete", id: deleteActivityId });

    // The original activities answer again, not Tombstones.
    const res = await call("GET", `/activities/${activityIds[0]}`, ATHENS);
    expect(res.status).toBe(200);
    expect(res.body.type).not.toBe("Tombstone");
  });
});

describe("what was never published leaves no trace", () => {
  it("archiving a pending-review process announces nothing and keeps the silent 404", async () => {
    // Written straight into the local stack: a submission still in the queue.
    const id = `proc_tomb${run}p`;
    await localRest("processes", {
      method: "POST",
      body: JSON.stringify({
        id,
        hub_id: "athens",
        type: "civic.vote",
        status: "pending_review",
        title: `Pending tombstone vote ${run}`,
        description: "",
        state: { options: ["Yes", "No"] },
      }),
    });
    const archived = await call("POST", `/admin/processes/${id}/archive`, ATHENS, { reason: "Removal test" }, admin);
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    const items = await publicActivities(id);
    expect(items).toEqual([]);
  });
});

describe("events.is_sample is the trigger's decision, not the inserter's", () => {
  it("a direct insert claiming is_sample on a real process is stored as not sample", async () => {
    const id = `evt_tomb${run}a`;
    await localRest("events", {
      method: "POST",
      body: JSON.stringify({
        id,
        hub_id: "athens",
        event_type: "civic.process.updated",
        actor: "system:test",
        process_id: voteId,
        jurisdiction: "local",
        action_url: `http://athens.localhost/process/${voteId}`,
        data: { process: { type: "civic.vote" } },
        meta: { visibility: "restricted" },
        is_sample: true,
      }),
    });
    const [row] = (await localRest(`events?select=is_sample&id=eq.${id}`)) as Array<{ is_sample: boolean }>;
    expect(row.is_sample, "a real process's event cannot be marked sample").toBe(false);
  });

  it("an event of a sample process is sample, whatever the inserter said", async () => {
    const sampleProcess = `proc_tomb${run}s`;
    // A well-formed announcement: Athens is a demo hub, so a sample is
    // publicly listed, and the list reads state.content.
    await localRest("processes", {
      method: "POST",
      body: JSON.stringify({
        id: sampleProcess,
        hub_id: "athens",
        type: "civic.announcement",
        status: "active",
        title: `Sample ${run}`,
        description: "",
        state: {
          status: "active",
          content: { title: `Sample ${run}`, body: "A sample the removal tests plant.", links: [] },
          author_id: "smoke",
          author_role: "admin",
          created_at: new Date().toISOString(),
          last_edited_at: null,
          edit_count: 0,
        },
        is_sample: true,
      }),
    });
    const id = `evt_tomb${run}s`;
    await localRest("events", {
      method: "POST",
      body: JSON.stringify({
        id,
        hub_id: "athens",
        event_type: "civic.process.updated",
        actor: "system:test",
        process_id: sampleProcess,
        jurisdiction: "local",
        action_url: `http://athens.localhost/process/${sampleProcess}`,
        data: { process: { type: "civic.announcement" } },
        meta: { visibility: "public" },
        is_sample: false,
      }),
    });
    const [row] = (await localRest(`events?select=is_sample&id=eq.${id}`)) as Array<{ is_sample: boolean }>;
    expect(row.is_sample).toBe(true);
  });
});
