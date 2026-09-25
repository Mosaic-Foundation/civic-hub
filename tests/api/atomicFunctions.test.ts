// Phase 2c: transition_process and cast_vote write everything or nothing, and
// only on their own hub.
//
// Each function is called the way forHub().rpc() calls it (PostgREST, service
// role, p_hub_id named), against the local stack. The forced failures are
// real failures part-way through: the event is the last write in both
// functions, so an event whose id already exists fails AFTER the status
// change or the ballot rows have been written inside the transaction — and
// the test then checks that none of them survived.
//
// The ballot-secrecy layout is asserted too: vote_records never gains a
// user_id, vote_participation never a receipt_id, and the bridge is the only
// row holding both.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";

const FLOYD = "floyd.civic.social";
const run = Date.now();
let voteId = "";
let otherId = "";
let firstEventId = "";

type Rows = Array<Record<string, unknown>>;
const rows = async (path: string) => (await localRest(path)) as Rows;

async function rpc(fn: string, args: Record<string, unknown>): Promise<{ ok: true; body: any } | { ok: false; error: string }> {
  try {
    return { ok: true, body: await localRest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) }) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function eventRow(id: string, processId: string, actor: string, eventType = "civic.process.vote_submitted") {
  return {
    id,
    version: "1.0",
    event_type: eventType,
    process_id: processId,
    actor,
    jurisdiction: "us-va-floyd",
    action_url: `https://floyd.civic.social/process/${processId}`,
    source: { hub_id: "civic-hub-local", hub_url: "https://floyd.civic.social" },
    dedupe_key: null,
    data: { vote: { changed: false }, process: { type: "civic.vote" } },
    meta: { visibility: "restricted" },
    created_at: new Date().toISOString(),
  };
}

const voter = (n: number) => `atomic-voter-${run}-${n}`;

async function ballotState(processId: string, userId: string) {
  return {
    participation: await rows(`vote_participation?process_id=eq.${processId}&user_id=eq.${userId}`),
    bridge: await rows(`active_vote_keys?process_id=eq.${processId}&user_id=eq.${userId}`),
    ballots: await rows(`vote_records?process_id=eq.${processId}`),
  };
}

async function createActiveVote(token: string, title: string): Promise<string> {
  const res = await call(
    "POST",
    "/process",
    FLOYD,
    {
      definition: { type: "civic.vote", version: "0.1" },
      title,
      description: "Atomic functions test.",
      state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
    },
    token,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const act = await call("POST", `/process/${res.body.id}/action`, FLOYD, { type: "process.activate", payload: {} }, token);
  expect(act.status, JSON.stringify(act.body)).toBe(200);
  return res.body.id;
}

beforeAll(async () => {
  const admin = await mintSession("floyd", "admin@example.test");
  voteId = await createActiveVote(admin, `Atomic vote ${run}`);
  otherId = await createActiveVote(admin, `Atomic transition ${run}`);
});

describe("cast_vote", () => {
  it("writes participation, ballot, bridge and event together", async () => {
    firstEventId = `evt_atomic_${run}_1`;
    const res = await rpc("cast_vote", {
      p_hub_id: "floyd",
      p_process_id: voteId,
      p_user_id: voter(1),
      p_choice: "Yes",
      p_event: eventRow(firstEventId, voteId, voter(1)),
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const { receipt_id, updated } = (res as { body: { receipt_id: string; updated: boolean } }).body;
    expect(updated).toBe(false);

    const s = await ballotState(voteId, voter(1));
    expect(s.participation).toHaveLength(1);
    expect(s.bridge).toEqual([expect.objectContaining({ receipt_id, hub_id: "floyd" })]);
    expect(s.ballots).toEqual([expect.objectContaining({ receipt_id, choice: "Yes", hub_id: "floyd" })]);
    expect(await rows(`events?id=eq.${firstEventId}`)).toHaveLength(1);

    // The secrecy layout: no user on a ballot, no receipt on participation.
    expect(Object.keys(s.ballots[0])).not.toContain("user_id");
    expect(Object.keys(s.participation[0])).not.toContain("receipt_id");
  });

  it("a failure at the last write (a duplicate event id) leaves no ballot, participation or bridge", async () => {
    const before = (await ballotState(voteId, voter(2))).ballots.length;
    const res = await rpc("cast_vote", {
      p_hub_id: "floyd",
      p_process_id: voteId,
      p_user_id: voter(2),
      p_choice: "No",
      p_event: eventRow(firstEventId, voteId, voter(2)),
    });
    expect(res.ok).toBe(false);
    const s = await ballotState(voteId, voter(2));
    expect(s.participation).toEqual([]);
    expect(s.bridge).toEqual([]);
    expect(s.ballots).toHaveLength(before);
  });

  it("the voter is not locked out by the failed attempt", async () => {
    const res = await rpc("cast_vote", {
      p_hub_id: "floyd",
      p_process_id: voteId,
      p_user_id: voter(2),
      p_choice: "No",
      p_event: eventRow(`evt_atomic_${run}_2`, voteId, voter(2)),
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
  });

  it("refuses a process on another hub, writing nothing", async () => {
    const res = await rpc("cast_vote", {
      p_hub_id: "athens",
      p_process_id: voteId,
      p_user_id: voter(3),
      p_choice: "Yes",
      p_event: null,
    });
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toMatch(/42501|not on hub/);
    expect((await ballotState(voteId, voter(3))).participation).toEqual([]);
  });

  it("refuses an event that names another hub", async () => {
    const res = await rpc("cast_vote", {
      p_hub_id: "floyd",
      p_process_id: voteId,
      p_user_id: voter(4),
      p_choice: "Yes",
      p_event: { ...eventRow(`evt_atomic_${run}_4`, voteId, voter(4)), hub_id: "athens" },
    });
    expect(res.ok).toBe(false);
    expect((await ballotState(voteId, voter(4))).participation).toEqual([]);
  });

  it("a re-vote keeps the receipt and changes only the choice", async () => {
    const before = await ballotState(voteId, voter(1));
    const res = await rpc("cast_vote", {
      p_hub_id: "floyd",
      p_process_id: voteId,
      p_user_id: voter(1),
      p_choice: "No",
      p_event: eventRow(`evt_atomic_${run}_1b`, voteId, voter(1)),
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const body = (res as { body: { receipt_id: string; updated: boolean } }).body;
    expect(body.updated).toBe(true);
    expect(body.receipt_id).toBe(before.bridge[0].receipt_id);
    const ballot = await rows(`vote_records?receipt_id=eq.${body.receipt_id}`);
    expect(ballot[0].choice).toBe("No");
  });

  it("with the bridge gone (the vote closed), a change is refused as already voted", async () => {
    await localRest(`active_vote_keys?process_id=eq.${voteId}&user_id=eq.${voter(2)}`, { method: "DELETE" });
    const res = await rpc("cast_vote", {
      p_hub_id: "floyd",
      p_process_id: voteId,
      p_user_id: voter(2),
      p_choice: "Yes",
      p_event: eventRow(`evt_atomic_${run}_2b`, voteId, voter(2)),
    });
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toMatch(/already_voted/);
    expect(await rows(`events?id=eq.evt_atomic_${run}_2b`)).toEqual([]);
  });
});

describe("transition_process", () => {
  const statusOf = async (id: string) => (await rows(`processes?id=eq.${id}&select=status,state`))[0];

  it("a failure at the event leaves the status and state as they were", async () => {
    const before = await statusOf(otherId);
    const res = await rpc("transition_process", {
      p_hub_id: "floyd",
      p_process_id: otherId,
      p_to_status: "closed",
      p_actor: "admin-test",
      p_event: eventRow(firstEventId, otherId, "admin-test", "civic.process.updated"),
      p_state: { marker: "must not persist" },
    });
    expect(res.ok).toBe(false);
    expect(await statusOf(otherId)).toEqual(before);
  });

  it("refuses a process on another hub", async () => {
    const before = await statusOf(otherId);
    const res = await rpc("transition_process", {
      p_hub_id: "athens",
      p_process_id: otherId,
      p_to_status: "closed",
      p_actor: "admin-test",
      p_event: null,
    });
    expect(res.ok).toBe(false);
    expect(await statusOf(otherId)).toEqual(before);
  });

  it("writes the status, the state and the event together", async () => {
    const eventId = `evt_atomic_${run}_t`;
    // The vote's own state, with the marker added: p_state replaces the whole
    // state, and a vote left without its config breaks Floyd's process list
    // for every test that runs after this one (the Phase 3 leak harness).
    const { state } = await statusOf(otherId);
    const res = await rpc("transition_process", {
      p_hub_id: "floyd",
      p_process_id: otherId,
      p_to_status: "closed",
      p_actor: "admin-test",
      p_event: eventRow(eventId, otherId, "admin-test", "civic.process.updated"),
      p_state: { ...(state as Record<string, unknown>), status: "closed", marker: "persisted" },
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect((res as { body: { previous_status: string } }).body.previous_status).toBe("active");
    const after = await statusOf(otherId);
    expect(after.status).toBe("closed");
    expect((after.state as { marker: string }).marker).toBe("persisted");
    expect(await rows(`events?id=eq.${eventId}&hub_id=eq.floyd`)).toHaveLength(1);
  });
});

describe("through the app", () => {
  it("a resident's vote and change go through cast_vote: one receipt, restricted events", async () => {
    const admin = await mintSession("floyd", "admin@example.test");
    const id = await createActiveVote(admin, `Atomic app vote ${run}`);
    const resident = await mintSession("floyd", `atomic-resident-${run}@example.test`);
    // A resident needs a name to participate.
    await call("PATCH", "/auth/me", FLOYD, { full_name: "Atomic Resident" }, resident);

    const first = await call("POST", `/process/${id}/action`, FLOYD, { type: "process.vote", payload: { option: "Yes" } }, resident);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const second = await call("POST", `/process/${id}/action`, FLOYD, { type: "process.vote", payload: { option: "No" } }, resident);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.result.receipt_id).toBe(first.body.result.receipt_id);
    expect(second.body.result.vote_updated).toBe(true);

    const events = await rows(`events?process_id=eq.${id}&event_type=eq.civic.process.vote_submitted`);
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect((e.meta as { visibility: string }).visibility).toBe("restricted");
      expect(JSON.stringify(e.data)).not.toMatch(/Yes|No/);
    }
    expect(await rows(`vote_records?process_id=eq.${id}`)).toEqual([
      expect.objectContaining({ receipt_id: first.body.result.receipt_id, choice: "No" }),
    ]);
  });

  it("a lifecycle change through the app writes its process.updated event", async () => {
    const admin = await mintSession("floyd", "admin@example.test");
    const id = await createActiveVote(admin, `Atomic app close ${run}`);
    const closed = await call("POST", `/process/${id}/action`, FLOYD, { type: "process.close", payload: {} }, admin);
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const updated = await rows(`events?process_id=eq.${id}&event_type=eq.civic.process.updated&order=created_at.desc&limit=1`);
    expect((updated[0].data as { process: { status: string } }).process.status).toBe("closed");
    expect((await rows(`processes?id=eq.${id}&select=status`))[0].status).toBe("closed");
  });
});
