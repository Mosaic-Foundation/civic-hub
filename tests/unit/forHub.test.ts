// forHub() — the hub-scoped data layer (BUILD-PLAN-multi-tenant.md, contract 3).
//
// No database: a real supabase-js client whose fetch is replaced by a
// recorder, so what is asserted is the exact request PostgREST would receive —
// the filter on every read, update and delete, the stamp on every insert and
// upsert — built by the same query builder the app uses.
//
// The same operations against two seeded hubs in a real database are
// tests/api/forHubIsolation.test.ts.

import { describe, it, expect, beforeEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { hubDbFrom, HUB_TABLES } from "../../src/db/forHub.js";

interface Captured {
  method: string;
  url: URL;
  body: unknown;
  prefer: string | null;
}

let calls: Captured[] = [];

const stub = createClient("http://stub.invalid", "stub-key", {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        method: init?.method ?? "GET",
        url: new URL(String(input)),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        prefer: headers.get("Prefer"),
      });
      return new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
});

const floyd = hubDbFrom(stub, "floyd");
const athens = hubDbFrom(stub, "athens");

function last(): Captured {
  const c = calls[calls.length - 1];
  if (!c) throw new Error("no request was sent");
  return c;
}

function hubFilters(c: Captured): string[] {
  return c.url.searchParams.getAll("hub_id");
}

beforeEach(() => {
  calls = [];
});

describe("forHub — construction", () => {
  it("carries its hub id", () => {
    expect(floyd.hubId).toBe("floyd");
    expect(athens.hubId).toBe("athens");
  });

  it("refuses a missing or malformed hub id", () => {
    for (const bad of ["", " ", "Floyd", "floyd;drop", "-x", "a"]) {
      expect(() => hubDbFrom(stub, bad), bad).toThrow(/hub id/i);
    }
  });

  it("refuses the registry and unknown tables", () => {
    expect(() => floyd.from("hubs" as never)).toThrow(/not a hub-scoped table/);
    expect(() => floyd.from("nope" as never)).toThrow(/not a hub-scoped table/);
  });

  it("covers every tenant table: 30, and never hubs", () => {
    expect(HUB_TABLES).toHaveLength(30);
    expect(HUB_TABLES).not.toContain("hubs");
  });
});

describe("forHub — reads are filtered", () => {
  it("select", async () => {
    await floyd.from("processes").select("*").eq("id", "proc_1");
    expect(last().method).toBe("GET");
    expect(hubFilters(last())).toEqual(["eq.floyd"]);
    expect(last().url.searchParams.get("id")).toBe("eq.proc_1");
  });

  it("select with count/head", async () => {
    await athens
      .from("vote_participation")
      .select("*", { count: "exact", head: true })
      .eq("user_id", "u");
    expect(last().method).toBe("HEAD");
    expect(hubFilters(last())).toEqual(["eq.athens"]);
  });

  it("single / maybeSingle keep the filter", async () => {
    await floyd.from("users").select("id").eq("email", "a@b.c").maybeSingle();
    expect(hubFilters(last())).toEqual(["eq.floyd"]);
  });

  it("each hub's client filters on its own hub", async () => {
    await floyd.from("events").select("*");
    const f = last();
    await athens.from("events").select("*");
    const a = last();
    expect(hubFilters(f)).toEqual(["eq.floyd"]);
    expect(hubFilters(a)).toEqual(["eq.athens"]);
  });
});

describe("forHub — inserts are stamped", () => {
  it("one row", async () => {
    await floyd.from("processes").insert({ id: "p1", title: "t" });
    expect(last().method).toBe("POST");
    expect(last().body).toEqual({ id: "p1", title: "t", hub_id: "floyd" });
  });

  it("many rows, and insert().select()", async () => {
    await athens
      .from("vote_records")
      .insert([{ receipt_id: "r1" }, { receipt_id: "r2" }])
      .select();
    expect(last().body).toEqual([
      { receipt_id: "r1", hub_id: "athens" },
      { receipt_id: "r2", hub_id: "athens" },
    ]);
  });

  it("the same hub_id in the payload is allowed", async () => {
    await floyd.from("events").insert({ id: "e1", hub_id: "floyd" });
    expect(last().body).toEqual({ id: "e1", hub_id: "floyd" });
  });

  it("another hub's hub_id in the payload throws, and nothing is sent", () => {
    expect(() => athens.from("processes").insert({ id: "p1", hub_id: "floyd" })).toThrow(
      /hub_id "floyd"/,
    );
    expect(() =>
      athens.from("processes").insert([{ id: "p1" }, { id: "p2", hub_id: "floyd" }]),
    ).toThrow(/hub_id "floyd"/);
    expect(calls).toHaveLength(0);
  });

  it("does not mutate the caller's object", async () => {
    const row = { id: "p1" };
    await floyd.from("processes").insert(row);
    expect(row).toEqual({ id: "p1" });
  });
});

describe("forHub — upserts are stamped and must conflict within the hub", () => {
  it("stamps and passes the conflict target through", async () => {
    await floyd
      .from("hub_settings")
      .upsert({ key: "k", value: "v" }, { onConflict: "hub_id,key" });
    expect(last().body).toEqual({ key: "k", value: "v", hub_id: "floyd" });
    expect(last().url.searchParams.get("on_conflict")).toBe("hub_id,key");
  });

  it("refuses a conflict target without hub_id — it would update another hub's row", () => {
    expect(() =>
      athens.from("pending_verifications").upsert({ email: "a@b.c" }, { onConflict: "email" }),
    ).toThrow(/onConflict/);
    expect(() => athens.from("link_previews").upsert({ url: "https://x" })).toThrow(
      /onConflict/,
    );
    expect(calls).toHaveLength(0);
  });

  it("refuses another hub's hub_id", () => {
    expect(() =>
      athens
        .from("waitlist")
        .upsert({ email: "a@b.c", hub_id: "floyd" }, { onConflict: "hub_id,email" }),
    ).toThrow(/hub_id "floyd"/);
  });
});

describe("forHub — updates and deletes are filtered", () => {
  it("update carries the hub filter beside the caller's", async () => {
    await floyd.from("processes").update({ status: "closed" }).eq("id", "p1");
    expect(last().method).toBe("PATCH");
    expect(hubFilters(last())).toEqual(["eq.floyd"]);
    expect(last().url.searchParams.get("id")).toBe("eq.p1");
    expect(last().body).toEqual({ status: "closed" });
  });

  it("an update may not move a row to another hub", () => {
    expect(() => athens.from("processes").update({ hub_id: "floyd" }).eq("id", "p1")).toThrow(
      /hub_id "floyd"/,
    );
    expect(calls).toHaveLength(0);
  });

  it("delete carries the hub filter", async () => {
    await athens.from("active_vote_keys").delete().eq("process_id", "p1");
    expect(last().method).toBe("DELETE");
    expect(hubFilters(last())).toEqual(["eq.athens"]);
  });

  it("a delete with no other filter still only reaches its own hub", async () => {
    await athens.from("events").delete().neq("id", "");
    expect(hubFilters(last())).toEqual(["eq.athens"]);
  });

  it("an update or delete that has lost its hub filter throws instead of running", async () => {
    // Nothing in the builder API removes a filter. This simulates the only
    // way one could vanish — someone reaching into the builder — and proves
    // the check runs at execution, not just at construction.
    const q = athens.from("processes").update({ status: "x" }).eq("id", "p1");
    (q as unknown as { url: URL }).url.searchParams.delete("hub_id");
    await expect(q).rejects.toThrow(/without its hub filter/);
    const d = athens.from("processes").delete().eq("id", "p1");
    (d as unknown as { url: URL }).url.searchParams.delete("hub_id");
    await expect(d).rejects.toThrow(/without its hub filter/);
    expect(calls).toHaveLength(0);
  });
});

describe("forHub — rpc", () => {
  it("passes the hub as the p_hub_id named argument", async () => {
    await floyd.rpc("search_processes", { q: "park" });
    expect(last().url.pathname).toMatch(/\/rpc\/search_processes$/);
    expect(last().body).toEqual({ q: "park", p_hub_id: "floyd" });
  });

  it("refuses another hub's p_hub_id", () => {
    expect(() => athens.rpc("search_processes", { p_hub_id: "floyd" })).toThrow(/p_hub_id/);
  });
});
