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
import { hubDbFrom, type HubDb } from "../../src/db/forHub.js";
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
  const a = await floyd.from("feedback_submissions").insert(feedback(FLOYD_ROW, "floyd's"));
  const b = await athens.from("feedback_submissions").insert(feedback(ATHENS_ROW, "athens's"));
  if (a.error || b.error) throw new Error(`seed: ${a.error?.message ?? b.error?.message}`);
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
    expect(one.data).toEqual({ id: FLOYD_ROW });

    const mine = await athens
      .from("feedback_submissions")
      .select("id")
      .in("id", [FLOYD_ROW, ATHENS_ROW]);
    expect(mine.data).toEqual([{ id: ATHENS_ROW }]);

    const counted = await athens
      .from("feedback_submissions")
      .select("*", { count: "exact", head: true })
      .in("id", [FLOYD_ROW, ATHENS_ROW]);
    expect(counted.count).toBe(1);
  });

  it("update and delete work on this hub's row", async () => {
    const up = await athens
      .from("feedback_submissions")
      .update({ message: "athens's, edited" })
      .eq("id", ATHENS_ROW)
      .select("message");
    expect(up.data).toEqual([{ message: "athens's, edited" }]);

    const ins = await athens.from("feedback_submissions").insert(feedback(`${ATHENS_ROW}_up`, "x"));
    expect(ins.error).toBeNull();
    const del = await athens
      .from("feedback_submissions")
      .delete()
      .eq("id", `${ATHENS_ROW}_up`)
      .select("id");
    expect(del.data).toEqual([{ id: `${ATHENS_ROW}_up` }]);
  });

  it("upsert within the hub, on a hub-leading conflict target", async () => {
    const first = await athens
      .from("users")
      .upsert({ id: `user_iso_${run}`, email: EMAIL }, { onConflict: "hub_id,email" })
      .select("id, hub_id");
    expect(first.error).toBeNull();
    expect(first.data).toEqual([{ id: `user_iso_${run}`, hub_id: "athens" }]);

    const again = await athens
      .from("users")
      .upsert({ id: `user_iso_${run}`, email: EMAIL, full_name: "Iso" }, { onConflict: "hub_id,email" })
      .select("full_name");
    expect(again.data).toEqual([{ full_name: "Iso" }]);
  });
});

describe("forHub against the database — another hub's rows", () => {
  it("a read by id returns nothing", async () => {
    const byId = await athens
      .from("feedback_submissions")
      .select("id")
      .eq("id", FLOYD_ROW)
      .maybeSingle();
    expect(byId.error).toBeNull();
    expect(byId.data).toBeNull();
  });

  it("an update by id changes nothing", async () => {
    const res = await athens
      .from("feedback_submissions")
      .update({ message: "overwritten from athens" })
      .eq("id", FLOYD_ROW)
      .select("id");
    expect(res.data).toEqual([]);
    const still = await raw.from("feedback_submissions").select("message").eq("id", FLOYD_ROW).single();
    expect(still.data?.message).toBe("floyd's");
  });

  it("a delete by id removes nothing", async () => {
    const res = await athens.from("feedback_submissions").delete().eq("id", FLOYD_ROW).select("id");
    expect(res.data).toEqual([]);
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
    const f = await floyd
      .from("pending_verifications")
      .upsert({ email: EMAIL, code: "111111", expires_at: expires }, { onConflict: "hub_id,email" });
    expect(f.error).toBeNull();
    const a = await athens
      .from("pending_verifications")
      .upsert({ email: EMAIL, code: "222222", expires_at: expires }, { onConflict: "hub_id,email" });
    expect(a.error?.code).toBe("23505");
    const row = await raw.from("pending_verifications").select("hub_id, code").eq("email", EMAIL).single();
    expect(row.data).toEqual({ hub_id: "floyd", code: "111111" });
  });
});
