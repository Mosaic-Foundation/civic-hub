// Phase 3 leak harness, database half: minted hub tokens straight at
// PostgREST, no app in between. What the policies alone refuse.
//
// leakHarness.test.ts walks the app; this file proves the second layer on its
// own terms, so it holds whatever the code does: a token for Athens sees no
// Floyd row in any hub table, cannot write one, cannot move a row across, and
// cannot drive transition_process or cast_vote (or their helpers) on Floyd.
// And for each atomic function, a failure forced part-way through under the
// minted token leaves no residue in any table it writes.
//
// The token is signed exactly as src/db/hubToken.ts signs it, with
// CIVIC_HUB_SIGNING_KEY if set, else the local stack's fixed HS256 secret.
// It does not depend on the server's flag, so both CI passes run it.
// LOCAL ONLY (localStack() refuses anything else). Needs `supabase start`.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac, createSign, randomBytes } from "node:crypto";
import { localRest, localStack } from "../fixtures/adminSession.js";
import { HUB_TABLES } from "../../src/db/forHub.js";
import { parseSigningKey, signHubToken } from "../../src/db/hubToken.js";

const LOCAL_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const LOCAL_PUBLISHABLE_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

const { url } = localStack();
const signer = parseSigningKey(process.env.CIVIC_HUB_SIGNING_KEY?.trim() || LOCAL_JWT_SECRET);
const apikey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || LOCAL_PUBLISHABLE_KEY;
const token = (hub: string) => signHubToken(signer, hub);
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** Sign arbitrary claims with the same key and algorithm as a hub token. */
function signClaims(claims: Record<string, unknown>): string {
  const input = `${b64({ alg: signer.alg, typ: "JWT", ...(signer.kid ? { kid: signer.kid } : {}) })}.${b64(claims)}`;
  const sig =
    signer.alg === "ES256"
      ? createSign("SHA256").update(input).sign({ key: signer.key, dsaEncoding: "ieee-p1363" })
      : createHmac("sha256", signer.secret).update(input).digest();
  return `${input}.${sig.toString("base64url")}`;
}

const run = randomBytes(4).toString("hex");
type Rows = Array<Record<string, unknown>>;
type Result = { status: number; body: any };

/** A PostgREST call carrying `bearer` (a hub token, or nothing: anon). */
async function rest(bearer: string | null, path: string, init: RequestInit = {}): Promise<Result> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey,
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { status: res.status, body };
}
const asHub = (hub: string, path: string, init?: RequestInit) => rest(token(hub), path, init);
const rpc = (hub: string, fn: string, args: Record<string, unknown>) =>
  asHub(hub, `rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });

// Fixtures: a Floyd process (hub B) and an Athens vote (hub A), both written
// by the service role.
const floydProcess = `proc_rlsdb_floyd_${run}`;
const athensVote = `proc_rlsdb_athens_${run}`;
const voter = (n: number) => `rlsdb-voter-${run}-${n}`;

function eventRow(id: string, processId: string, actor: string, eventType: string) {
  return {
    id,
    version: "1.0",
    event_type: eventType,
    process_id: processId,
    actor,
    jurisdiction: "test",
    action_url: `http://athens.localhost/process/${processId}`,
    source: { hub_id: "civic-hub-local", hub_url: "http://athens.localhost" },
    dedupe_key: null,
    data: { vote: { changed: false }, process: { type: "civic.vote" } },
    meta: { visibility: "restricted" },
    created_at: new Date().toISOString(),
  };
}

const VOTE_STATE = {
  config: { options: ["Yes", "No"], support_threshold: 5, voting_duration_ms: 86_400_000 },
  status: "active",
  support_count: 0,
  supporters: [],
  votes: {},
};

beforeAll(async () => {
  for (const [id, hub, title] of [
    [floydProcess, "floyd", `RLS db Floyd ${run}`],
    [athensVote, "athens", `RLS db Athens ${run}`],
  ]) {
    await localRest("processes", {
      method: "POST",
      body: JSON.stringify({ id, hub_id: hub, type: "civic.vote", title, description: title, status: "active", state: VOTE_STATE }),
    });
  }
});

afterAll(async () => {
  for (const t of ["active_vote_keys", "vote_participation", "vote_records"]) {
    await localRest(`${t}?process_id=eq.${athensVote}`, { method: "DELETE" }).catch(() => undefined);
  }
  await localRest(`feedback_submissions?id=like.fb_rlsdb_${run}*`, { method: "DELETE" }).catch(() => undefined);
});

describe("reads: a hub token sees only its hub", () => {
  it("in every hub table, no row of any other hub", async () => {
    const problems: string[] = [];
    for (const table of HUB_TABLES) {
      for (const hub of ["athens", "floyd"]) {
        const res = await asHub(hub, `${table}?select=hub_id&hub_id=neq.${hub}&limit=1`);
        if (res.status !== 200) problems.push(`${hub} ${table}: ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
        else if ((res.body as Rows).length) problems.push(`${hub} ${table}: saw ${JSON.stringify(res.body)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("…while the service role still sees both hubs, and each token sees its own", async () => {
    expect(((await localRest(`processes?select=id&id=in.(${floydProcess},${athensVote})`)) as Rows).length).toBe(2);
    expect((await asHub("athens", `processes?select=id&id=eq.${athensVote}`)).body).toEqual([{ id: athensVote }]);
    expect((await asHub("athens", `processes?select=id&id=eq.${floydProcess}`)).body).toEqual([]);
    expect((await asHub("floyd", `processes?select=id&id=eq.${floydProcess}`)).body).toEqual([{ id: floydProcess }]);
  });

  it("a valid token with no hub_id claim sees nothing; anon is denied; a forged token is refused", async () => {
    const now = Math.floor(Date.now() / 1000);
    const noHub = signClaims({ iss: "civic-hub", role: "authenticated", iat: now, exp: now + 60 });
    const claimless = await rest(noHub, "processes?select=id&limit=5");
    expect(claimless.status, JSON.stringify(claimless.body)).toBe(200);
    expect(claimless.body).toEqual([]);

    const anon = await rest(null, "processes?select=id&limit=1");
    expect(anon.status === 200 ? anon.body : [], JSON.stringify(anon.body)).toEqual([]);

    // Athens's signature on a payload that says Floyd.
    const [h, , sig] = token("athens").split(".");
    const forged = `${h}.${b64({ role: "authenticated", hub_id: "floyd", iat: now, exp: now + 60 })}.${sig}`;
    expect((await rest(forged, "processes?select=id&limit=1")).status).toBe(401);
  });
});

describe("writes: a hub token cannot write another hub's rows", () => {
  it("an insert naming another hub is refused with 42501, in every table the app writes most", async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["processes", { id: `proc_rlsdb_x_${run}`, hub_id: "floyd", type: "civic.vote", title: "x", status: "draft", state: {} }],
      ["events", { ...eventRow(`evt_rlsdb_x_${run}`, floydProcess, "x", "civic.process.updated"), hub_id: "floyd" }],
      ["hub_settings", { hub_id: "floyd", key: `test.rlsdb_${run}`, value: "x" }],
      ["feedback_submissions", { id: `fb_rlsdb_${run}_x`, hub_id: "floyd", category: "general", message: "x" }],
      ["vote_records", { receipt_id: `rcpt_rlsdb_${run}`, hub_id: "floyd", process_id: floydProcess, choice: "Yes" }],
      ["vote_participation", { hub_id: "floyd", user_id: voter(9), process_id: floydProcess, has_voted: true }],
      ["active_vote_keys", { hub_id: "floyd", user_id: voter(9), process_id: floydProcess, receipt_id: `rcpt_rlsdb_${run}` }],
    ];
    for (const [table, row] of cases) {
      const res = await asHub("athens", table, { method: "POST", body: JSON.stringify(row) });
      expect(res.body?.code, `${table}: ${JSON.stringify(res.body)}`).toBe("42501");
    }
    // The control: the same insert for its own hub goes through.
    const own = await asHub("athens", "feedback_submissions", {
      method: "POST",
      body: JSON.stringify({ id: `fb_rlsdb_${run}_own`, hub_id: "athens", category: "general", message: "own hub" }),
    });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
  });

  it("an update or delete of another hub's row touches nothing", async () => {
    const before = await localRest(`processes?id=eq.${floydProcess}`);
    const upd = await asHub("athens", `processes?id=eq.${floydProcess}`, { method: "PATCH", body: JSON.stringify({ title: "moved" }) });
    expect(upd.body).toEqual([]);
    const del = await asHub("athens", `processes?id=eq.${floydProcess}`, { method: "DELETE" });
    expect(del.body).toEqual([]);
    expect(await localRest(`processes?id=eq.${floydProcess}`)).toEqual(before);
  });

  it("a row cannot be moved to another hub (WITH CHECK)", async () => {
    const res = await asHub("athens", `feedback_submissions?id=eq.fb_rlsdb_${run}_own`, {
      method: "PATCH",
      body: JSON.stringify({ hub_id: "floyd" }),
    });
    expect(res.body?.code, JSON.stringify(res.body)).toBe("42501");
  });
});

describe("the atomic functions under a hub token", () => {
  it("cannot be driven on another hub's process: it is not there for this token", async () => {
    const before = await localRest(`processes?id=eq.${floydProcess}&select=status,state`);
    // Under RLS Floyd's process is invisible to an Athens token, so the lock
    // finds nothing (P0002) whichever hub the call names — the database does
    // not even confirm the process exists. The 42501 hub checks inside the
    // functions are the service-role path's guard (tests/api/atomicFunctions).
    for (const p_hub_id of ["athens", "floyd"]) {
      const t = await rpc("athens", "transition_process", {
        p_hub_id, p_process_id: floydProcess, p_to_status: "closed", p_actor: "rlsdb", p_event: null,
      });
      expect(t.body?.code, JSON.stringify(t.body)).toBe("P0002");
      const v = await rpc("athens", "cast_vote", {
        p_hub_id, p_process_id: floydProcess, p_user_id: voter(1), p_choice: "Yes", p_event: null,
      });
      expect(v.body?.code, JSON.stringify(v.body)).toBe("P0002");
    }
    const lock = await rpc("athens", "_civic_lock_process", { p_hub_id: "floyd", p_process_id: floydProcess });
    expect(lock.body?.code).toBe("P0002");
    expect(await localRest(`processes?id=eq.${floydProcess}&select=status,state`)).toEqual(before);
    expect(await localRest(`vote_participation?process_id=eq.${floydProcess}`)).toEqual([]);
  });

  it("their event helper refuses to write an event for another hub: 42501", async () => {
    const id = `evt_rlsdb_helper_${run}`;
    const res = await rpc("athens", "_civic_insert_event", {
      p_hub_id: "floyd",
      p_process_id: floydProcess,
      p_actor: "rlsdb",
      p_event: eventRow(id, floydProcess, "rlsdb", "civic.process.updated"),
    });
    expect(res.body?.code, JSON.stringify(res.body)).toBe("42501");
    expect(await localRest(`events?id=eq.${id}`)).toEqual([]);
  });

  it("search, as Athens, finds nothing of Floyd's even when asked for Floyd", async () => {
    const res = await rpc("athens", "search_processes", { p_hub_id: "floyd", p_q: `Floyd ${run}` });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  let firstEventId = "";
  const ballotRows = async (userId: string) => ({
    participation: await localRest(`vote_participation?process_id=eq.${athensVote}&user_id=eq.${userId}`),
    bridge: await localRest(`active_vote_keys?process_id=eq.${athensVote}&user_id=eq.${userId}`),
  });

  it("cast_vote works for its own hub under the token (the control)", async () => {
    firstEventId = `evt_rlsdb_${run}_1`;
    const res = await rpc("athens", "cast_vote", {
      p_hub_id: "athens",
      p_process_id: athensVote,
      p_user_id: voter(1),
      p_choice: "Yes",
      p_event: eventRow(firstEventId, athensVote, voter(1), "civic.process.vote_submitted"),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = await ballotRows(voter(1));
    expect(s.participation).toHaveLength(1);
    expect(s.bridge).toEqual([expect.objectContaining({ hub_id: "athens", receipt_id: res.body.receipt_id })]);
    expect(await localRest(`vote_records?receipt_id=eq.${res.body.receipt_id}&select=choice,hub_id`)).toEqual([
      { choice: "Yes", hub_id: "athens" },
    ]);
  });

  it("cast_vote: a failure at its last write leaves no ballot, participation, bridge or event", async () => {
    const ballotsBefore = await localRest(`vote_records?process_id=eq.${athensVote}&select=receipt_id,choice&order=receipt_id`);
    const eventsBefore = await localRest(`events?process_id=eq.${athensVote}&select=id&order=id`);
    // The event id already exists: the insert fails after the three ballot
    // rows were written inside the transaction.
    const res = await rpc("athens", "cast_vote", {
      p_hub_id: "athens",
      p_process_id: athensVote,
      p_user_id: voter(2),
      p_choice: "No",
      p_event: eventRow(firstEventId, athensVote, voter(2), "civic.process.vote_submitted"),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body?.code, JSON.stringify(res.body)).toBe("23505");
    expect(await ballotRows(voter(2))).toEqual({ participation: [], bridge: [] });
    expect(await localRest(`vote_records?process_id=eq.${athensVote}&select=receipt_id,choice&order=receipt_id`)).toEqual(ballotsBefore);
    expect(await localRest(`events?process_id=eq.${athensVote}&select=id&order=id`)).toEqual(eventsBefore);
    // And the voter is not locked out: the next attempt goes through.
    const retry = await rpc("athens", "cast_vote", {
      p_hub_id: "athens", p_process_id: athensVote, p_user_id: voter(2), p_choice: "No",
      p_event: eventRow(`evt_rlsdb_${run}_2`, athensVote, voter(2), "civic.process.vote_submitted"),
    });
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
  });

  it("transition_process: a failure at its last write leaves status, state and events as they were", async () => {
    const before = await localRest(`processes?id=eq.${athensVote}&select=status,state,updated_at`);
    const eventsBefore = await localRest(`events?process_id=eq.${athensVote}&select=id&order=id`);
    const res = await rpc("athens", "transition_process", {
      p_hub_id: "athens",
      p_process_id: athensVote,
      p_to_status: "closed",
      p_actor: "rlsdb",
      p_event: eventRow(firstEventId, athensVote, "rlsdb", "civic.process.updated"),
      p_state: { ...VOTE_STATE, status: "closed", marker: "must not persist" },
    });
    expect(res.body?.code, JSON.stringify(res.body)).toBe("23505");
    expect(await localRest(`processes?id=eq.${athensVote}&select=status,state,updated_at`)).toEqual(before);
    expect(await localRest(`events?process_id=eq.${athensVote}&select=id&order=id`)).toEqual(eventsBefore);
  });

  it("transition_process works for its own hub under the token (the control)", async () => {
    const eventId = `evt_rlsdb_${run}_t`;
    const res = await rpc("athens", "transition_process", {
      p_hub_id: "athens",
      p_process_id: athensVote,
      p_to_status: "closed",
      p_actor: "rlsdb",
      p_event: eventRow(eventId, athensVote, "rlsdb", "civic.process.updated"),
      p_state: { ...VOTE_STATE, status: "closed" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.previous_status).toBe("active");
    expect(await localRest(`events?id=eq.${eventId}&select=hub_id`)).toEqual([{ hub_id: "athens" }]);
  });
});
