// forHub() against a real database: two seeded hubs, every operation, and
// the cross-hub cases — which return nothing, change nothing, or throw.
//
// The unit layer (tests/unit/forHub.test.ts) proves the request forHub()
// builds. This proves what Postgres does with it, including the constraints
// Phase 2a added: a hub cannot read, update or delete another hub's row by
// id, and the per-hub uniqueness sits beside the old global kind.
//
// Needs the local Supabase stack (`supabase start`), not the dev server.
// LOCAL ONLY: refuses any SUPABASE_URL that is not this machine, like
// tests/fixtures/adminSession.ts, because it writes rows.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { hubDbFrom, HubDbError, type HubDb } from "../../src/db/forHub.js";
import { localStack } from "../fixtures/adminSession.js";

const { url, key } = localStack();
const raw = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Both hubs exist in every local stack: floyd from the hubs migration,
// athens from supabase/seed.sql.
const floyd: HubDb = hubDbFrom(raw, "floyd");
const athens: HubDb = hubDbFrom(raw, "athens");

const run = randomBytes(4).toString("hex");
const FLOYD_ROW = `fb_isofloyd_${run}`;
const ATHENS_ROW = `fb_isoathens_${run}`;
const EMAIL = `iso-${run}@example.test`;

function feedback(id: string, message: string) {
  return { id, category: "general", message };
}

beforeAll(async () => {
  await floyd.from("feedback_submissions").insert(feedback(FLOYD_ROW, "floyd's"));
  await athens.from("feedback_submissions").insert(feedback(ATHENS_ROW, "athens's"));
});

afterAll(async () => {
  await raw.from("feedback_submissions").delete().in("id", [FLOYD_ROW, ATHENS_ROW, `${ATHENS_ROW}_up`]);
  await raw.from("users").delete().like("email", `%${run}%`);
  await raw.from("pending_verifications").delete().like("email", `%${run}%`);
});

describe("forHub against the database — own hub", () => {
  it("insert stamps the hub", async () => {
    const { data } = await raw
      .from("feedback_submissions")
      .select("id, hub_id")
      .in("id", [FLOYD_ROW, ATHENS_ROW])
      .order("id");
    expect(data).toEqual([
      { id: ATHENS_ROW, hub_id: "athens" },
      { id: FLOYD_ROW, hub_id: "floyd" },
    ]);
  });

  it("select, count, maybeSingle see only this hub's rows", async () => {
    const one = await floyd
      .from("feedback_submissions")
      .select("id")
      .eq("id", FLOYD_ROW)
      .maybeSingle();
    expect(one).toEqual({ id: FLOYD_ROW });

    const mine = await athens
      .from("feedback_submissions")
      .select("id")
      .in("id", [FLOYD_ROW, ATHENS_ROW]);
    expect(mine).toEqual([{ id: ATHENS_ROW }]);

    const counted = await athens
      .from("feedback_submissions")
      .count()
      .in("id", [FLOYD_ROW, ATHENS_ROW]);
    expect(counted).toBe(1);
  });

  it("update and delete work on this hub's row", async () => {
    const up = await athens
      .from("feedback_submissions")
      .update({ message: "athens's, edited" })
      .eq("id", ATHENS_ROW)
      .select("message");
    expect(up).toEqual([{ message: "athens's, edited" }]);

    expect(await athens.from("feedback_submissions").insert(feedback(`${ATHENS_ROW}_up`, "x"))).toBeNull();
    const del = await athens
      .from("feedback_submissions")
      .delete()
      .eq("id", `${ATHENS_ROW}_up`)
      .select("id");
    expect(del).toEqual([{ id: `${ATHENS_ROW}_up` }]);
  });

  it("upsert within the hub, on a hub-leading conflict target", async () => {
    const first = await athens
      .from("users")
      .upsert({ id: `user_iso_${run}`, email: EMAIL }, { onConflict: "hub_id,email" })
      .select("id, hub_id");
    expect(first).toEqual([{ id: `user_iso_${run}`, hub_id: "athens" }]);

    const again = await athens
      .from("users")
      .upsert({ id: `user_iso_${run}`, email: EMAIL, full_name: "Iso" }, { onConflict: "hub_id,email" })
      .select("full_name");
    expect(again).toEqual([{ full_name: "Iso" }]);
  });
});

describe("forHub against the database — another hub's rows", () => {
  it("a read by id returns nothing", async () => {
    const byId = await athens
      .from("feedback_submissions")
      .select("id")
      .eq("id", FLOYD_ROW)
      .maybeSingle();
    expect(byId).toBeNull();
  });

  it("an update by id changes nothing", async () => {
    const res = await athens
      .from("feedback_submissions")
      .update({ message: "overwritten from athens" })
      .eq("id", FLOYD_ROW)
      .select("id");
    expect(res).toEqual([]);
    const still = await raw.from("feedback_submissions").select("message").eq("id", FLOYD_ROW).single();
    expect(still.data?.message).toBe("floyd's");
  });

  it("a delete by id removes nothing", async () => {
    const res = await athens.from("feedback_submissions").delete().eq("id", FLOYD_ROW).select("id");
    expect(res).toEqual([]);
    const still = await raw.from("feedback_submissions").select("id").eq("id", FLOYD_ROW);
    expect(still.data).toHaveLength(1);
  });

  it("an insert naming the other hub throws before reaching the database", () => {
    expect(() =>
      athens.from("feedback_submissions").insert({ ...feedback(`${ATHENS_ROW}_x`, "x"), hub_id: "floyd" }),
    ).toThrow(/hub_id "floyd"/);
  });

  it("an upsert that would conflict on a global key throws", () => {
    expect(() =>
      athens.from("pending_verifications").upsert(
        { email: EMAIL, code: "123456", expires_at: new Date().toISOString() },
        { onConflict: "email" },
      ),
    ).toThrow(/onConflict/);
  });

  it("until cleanup, the old global unique still refuses a second hub's copy — it never overwrites", async () => {
    // Floyd writes a code for EMAIL; Athens tries the same email on its own
    // hub-leading target. The global primary key (email) still stands, so the
    // database refuses — and Floyd's row is left exactly as it was.
    const expires = new Date(Date.now() + 600_000).toISOString();
    await floyd
      .from("pending_verifications")
      .upsert({ email: EMAIL, code: "111111", expires_at: expires }, { onConflict: "hub_id,email" });
    const refused = await athens
      .from("pending_verifications")
      .upsert({ email: EMAIL, code: "222222", expires_at: expires }, { onConflict: "hub_id,email" })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(refused).toBeInstanceOf(HubDbError);
    expect((refused as HubDbError).code).toBe("23505");
    const row = await raw.from("pending_verifications").select("hub_id, code").eq("email", EMAIL).single();
    expect(row.data).toEqual({ hub_id: "floyd", code: "111111" });
  });
});

describe("search is scoped to the hub (search_processes with p_hub_id)", () => {
  // One active process per hub, both matching a word nothing else contains.
  const WORD = `zqx${run}`;
  const ids = { floyd: `proc_isosearch_f_${run}`, athens: `proc_isosearch_a_${run}` };

  beforeAll(async () => {
    for (const [hub, id] of Object.entries(ids)) {
      await hubDbFrom(raw, hub).from("processes").insert({
        id,
        type: "civic.vote",
        title: `Isolation ${WORD}`,
        status: "active",
        state: {},
      });
    }
  });

  afterAll(async () => {
    await raw.from("processes").delete().in("id", Object.values(ids));
  });

  it("each hub finds only its own process", async () => {
    const a = await athens.rpc<Array<{ id: string }>>("search_processes", { p_q: WORD });
    const f = await floyd.rpc<Array<{ id: string }>>("search_processes", { p_q: WORD });
    expect(a.map((r) => r.id)).toEqual([ids.athens]);
    expect(f.map((r) => r.id)).toEqual([ids.floyd]);
  });

  it("the count agrees", async () => {
    const a = await athens.rpc("search_processes_count", { p_q: WORD });
    expect(Number(a)).toBe(1);
  });

  it("the deprecated unscoped signature answers for the migration-default hub only", async () => {
    const old = await raw.rpc("search_processes", { p_q: WORD });
    expect(old.error).toBeNull();
    expect((old.data as Array<{ id: string }>).map((r) => r.id)).toEqual([ids.floyd]);
    const oldCount = await raw.rpc("search_processes_count", { p_q: WORD });
    expect(Number(oldCount.data)).toBe(1);
  });
});

describe("composite foreign keys: a row references only its own hub's rows", () => {
  // Phase 2b step 1 (20260924060000). The database refuses a cross-hub
  // reference whoever writes it: through forHub(), and through the raw
  // service-role client, which is what the control plane holds.
  const floydUser = `user_fkfloyd_${run}`;
  const athensUser = `user_fkathens_${run}`;

  beforeAll(async () => {
    await floyd.from("users").insert({ id: floydUser, email: `fk-floyd-${run}@example.test` });
    await athens.from("users").insert({ id: athensUser, email: `fk-athens-${run}@example.test` });
  });

  afterAll(async () => {
    await raw.from("sessions").delete().in("user_id", [floydUser, athensUser]);
    await raw.from("feedback_submissions").delete().like("id", `fb_fk%_${run}`);
    await raw.from("users").delete().in("id", [floydUser, athensUser]);
  });

  const session = (userId: string) => ({
    token: `sess_fk_${randomBytes(8).toString("hex")}`,
    user_id: userId,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });

  it("a session for a Floyd user under Athens's hub_id is rejected", async () => {
    const err = await athens
      .from("sessions")
      .insert(session(floydUser))
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(HubDbError);
    expect((err as HubDbError).code).toBe("23503");
    expect((err as HubDbError).message).toContain("sessions_hub_user_id_fkey");
  });

  it("…also when written with the raw client, past forHub()", async () => {
    const res = await raw.from("sessions").insert({ ...session(floydUser), hub_id: "athens" });
    expect(res.error?.code).toBe("23503");
  });

  it("control: the same session on the user's own hub is accepted", async () => {
    await expect(floyd.from("sessions").insert(session(floydUser))).resolves.toBeNull();
    await expect(athens.from("sessions").insert(session(athensUser))).resolves.toBeNull();
  });

  it("a nullable reference is refused across hubs, and a null is not checked", async () => {
    const cross = await athens
      .from("feedback_submissions")
      .insert({ id: `fb_fkcross_${run}`, category: "general", message: "x", user_id: floydUser })
      .then(() => null, (e: unknown) => e);
    expect((cross as HubDbError).code).toBe("23503");
    await expect(
      athens
        .from("feedback_submissions")
        .insert({ id: `fb_fknull_${run}`, category: "general", message: "x", user_id: null }),
    ).resolves.toBeNull();
  });

  it("deleting a user nulls its feedback's user_id and keeps the row's hub (SET NULL (user_id))", async () => {
    const tmp = `user_fktmp_${run}`;
    await athens.from("users").insert({ id: tmp, email: `fk-tmp-${run}@example.test` });
    await athens
      .from("feedback_submissions")
      .insert({ id: `fb_fktmp_${run}`, category: "general", message: "x", user_id: tmp });
    await athens.from("users").delete().eq("id", tmp);
    const row = await athens
      .from("feedback_submissions")
      .select("user_id, hub_id")
      .eq("id", `fb_fktmp_${run}`)
      .single();
    expect(row).toEqual({ user_id: null, hub_id: "athens" });
  });
});
