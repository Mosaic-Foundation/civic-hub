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
// user_id or a time, vote_participation never a receipt_id, and since
// 2026-10-10 nothing writes the bridge: cast_ballot (which replaced cast_vote)
// changes a ballot only for the receipt and change key the voter holds.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { createHash } from "node:crypto";
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
const keyHash = (key: string) => createHash("sha256").update(key, "utf8").digest("hex");
const keyOf = (n: number) => `change-key-${run}-${n}`;

/** cast_ballot's arguments: a first vote (new key) unless `held` is given. */
function ballot(
  hub: string,
  processId: string,
  n: number,
  choice: string,
  event: Record<string, unknown> | null,
  held: { receipt_id: string; key: string } | null = null,
) {
  return {
    p_hub_id: hub,
    p_process_id: processId,
    p_user_id: voter(n),
    p_choice: choice,
    p_event: event,
    p_receipt: held?.receipt_id ?? null,
    p_key_hash: held ? keyHash(held.key) : null,
    p_new_key_hash: keyHash(keyOf(n)),
  };
}

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

describe("cast_ballot", () => {
  let firstReceipt = "";

  it("writes participation, ballot and event together, and no bridge", async () => {
    firstEventId = `evt_atomic_${run}_1`;
    const res = await rpc("cast_ballot", ballot("floyd", voteId, 1, "Yes", eventRow(firstEventId, voteId, voter(1))));
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const { receipt_id, updated } = (res as { body: { receipt_id: string; updated: boolean } }).body;
    expect(updated).toBe(false);
    firstReceipt = receipt_id;

    const s = await ballotState(voteId, voter(1));
    expect(s.participation).toHaveLength(1);
    expect(s.bridge).toEqual([]);
    expect(s.ballots).toEqual([
      expect.objectContaining({ receipt_id, choice: "Yes", hub_id: "floyd", change_key_hash: keyHash(keyOf(1)), created_at: null }),
    ]);
    expect(await rows(`events?id=eq.${firstEventId}`)).toHaveLength(1);

    // The secrecy layout: no user on a ballot, no receipt on participation.
    expect(Object.keys(s.ballots[0])).not.toContain("user_id");
    expect(Object.keys(s.participation[0])).not.toContain("receipt_id");
  });

  it("a failure at the last write (a duplicate event id) leaves no ballot or participation", async () => {
    const before = (await ballotState(voteId, voter(2))).ballots.length;
    const res = await rpc("cast_ballot", ballot("floyd", voteId, 2, "No", eventRow(firstEventId, voteId, voter(2))));
    expect(res.ok).toBe(false);
    const s = await ballotState(voteId, voter(2));
    expect(s.participation).toEqual([]);
    expect(s.bridge).toEqual([]);
    expect(s.ballots).toHaveLength(before);
  });

  it("the voter is not locked out by the failed attempt", async () => {
    const res = await rpc("cast_ballot", ballot("floyd", voteId, 2, "No", eventRow(`evt_atomic_${run}_2`, voteId, voter(2))));
    expect(res.ok, JSON.stringify(res)).toBe(true);
  });

  it("refuses a process on another hub, writing nothing", async () => {
    const res = await rpc("cast_ballot", ballot("athens", voteId, 3, "Yes", null));
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toMatch(/42501|not on hub/);
    expect((await ballotState(voteId, voter(3))).participation).toEqual([]);
  });

  it("refuses an event that names another hub", async () => {
    const res = await rpc(
      "cast_ballot",
      ballot("floyd", voteId, 4, "Yes", { ...eventRow(`evt_atomic_${run}_4`, voteId, voter(4)), hub_id: "athens" }),
    );
    expect(res.ok).toBe(false);
    expect((await ballotState(voteId, voter(4))).participation).toEqual([]);
  });

  it("a change with the receipt and its key keeps the receipt and changes only the choice", async () => {
    const res = await rpc(
      "cast_ballot",
      ballot("floyd", voteId, 1, "No", eventRow(`evt_atomic_${run}_1b`, voteId, voter(1)), { receipt_id: firstReceipt, key: keyOf(1) }),
    );
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const body = (res as { body: { receipt_id: string; updated: boolean; unchanged: boolean } }).body;
    expect(body).toMatchObject({ receipt_id: firstReceipt, updated: true, unchanged: false });
    const after = await rows(`vote_records?receipt_id=eq.${firstReceipt}`);
    expect(after[0]).toMatchObject({ choice: "No", change_key_hash: keyHash(keyOf(1)), created_at: null });
  });

  it("the same choice again writes nothing and no event", async () => {
    const res = await rpc(
      "cast_ballot",
      ballot("floyd", voteId, 1, "No", eventRow(`evt_atomic_${run}_1c`, voteId, voter(1)), { receipt_id: firstReceipt, key: keyOf(1) }),
    );
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect((res as { body: { unchanged: boolean } }).body.unchanged).toBe(true);
    expect(await rows(`events?id=eq.evt_atomic_${run}_1c`)).toEqual([]);
  });

  it("without the receipt, a second vote is refused as already voted", async () => {
    const res = await rpc("cast_ballot", ballot("floyd", voteId, 2, "Yes", eventRow(`evt_atomic_${run}_2b`, voteId, voter(2))));
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toMatch(/already_voted/);
    expect(await rows(`events?id=eq.evt_atomic_${run}_2b`)).toEqual([]);
  });

  it("someone else's receipt, or the wrong key, changes nothing", async () => {
    // Voter 2 presents voter 1's receipt (public in the vote log once closed).
    for (const key of [keyOf(2), keyOf(1) + "x"]) {
      const res = await rpc(
        "cast_ballot",
        ballot("floyd", voteId, 2, "Yes", eventRow(`evt_atomic_${run}_2c`, voteId, voter(2)), { receipt_id: firstReceipt, key }),
      );
      expect(res.ok).toBe(false);
      expect((res as { error: string }).error).toMatch(/receipt_not_accepted/);
    }
    expect((await rows(`vote_records?receipt_id=eq.${firstReceipt}`))[0].choice).toBe("No");
    expect(await rows(`events?id=eq.evt_atomic_${run}_2c`)).toEqual([]);
  });

  it("a receipt presented by someone who has not voted is refused, writing nothing", async () => {
    const res = await rpc(
      "cast_ballot",
      ballot("floyd", voteId, 5, "Yes", eventRow(`evt_atomic_${run}_5`, voteId, voter(5)), { receipt_id: firstReceipt, key: keyOf(1) }),
    );
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toMatch(/receipt_without_vote/);
    expect((await ballotState(voteId, voter(5))).participation).toEqual([]);
  });

  it("reshuffle_ballots keeps every receipt, choice and key, and refuses another hub", async () => {
    const before = await rows(`vote_records?process_id=eq.${voteId}&select=receipt_id,choice,change_key_hash&order=receipt_id`);
    const res = await rpc("reshuffle_ballots", { p_hub_id: "floyd", p_process_id: voteId });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect((res as { body: number }).body).toBe(before.length);
    expect(await rows(`vote_records?process_id=eq.${voteId}&select=receipt_id,choice,change_key_hash&order=receipt_id`)).toEqual(before);
    const other = await rpc("reshuffle_ballots", { p_hub_id: "athens", p_process_id: voteId });
    expect(other.ok).toBe(false);
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
  it("a resident's vote and change go through cast_ballot: one receipt, restricted events", async () => {
    const admin = await mintSession("floyd", "admin@example.test");
    const id = await createActiveVote(admin, `Atomic app vote ${run}`);
    const resident = await mintSession("floyd", `atomic-resident-${run}@example.test`);
    // A resident needs a name to participate.
    await call("PATCH", "/auth/me", FLOYD, { full_name: "Atomic Resident" }, resident);

    const first = await call("POST", `/process/${id}/action`, FLOYD, { type: "process.vote", payload: { option: "Yes" } }, resident);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const held = { receipt_id: first.body.result.receipt_id, change_key: first.body.result.change_key };
    expect(typeof held.change_key).toBe("string");
    const second = await call(
      "POST",
      `/process/${id}/action`,
      FLOYD,
      { type: "process.vote", payload: { option: "No", receipt: held } },
      resident,
    );
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.result.receipt_id).toBe(first.body.result.receipt_id);
    expect(second.body.result.vote_updated).toBe(true);
    expect(second.body.result.change_key).toBeUndefined();

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
    // A vote finishes when it closes (2026-10-07): one transition, active →
    // finalized, written with its process.updated event.
    expect((updated[0].data as { process: { status: string } }).process.status).toBe("finalized");
    expect((await rows(`processes?id=eq.${id}&select=status`))[0].status).toBe("finalized");
  });
});
