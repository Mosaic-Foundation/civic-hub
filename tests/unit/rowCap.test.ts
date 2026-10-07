// @civic-raw-client-importer: drives forHub() over a supabase-js client with a stubbed fetch; no database.
// The 1,000-row cap (2026-10-07): PostgREST answers a read with at most 1,000
// rows and says nothing about the rest. forHub() refuses a read with no limit
// that comes back full, and readAll() pages past the cap.
//
// The stub plays PostgREST over a table of N rows: it honours `offset` and
// `limit`, and never returns more than 1,000. The same guard against a real
// database with 1,200 events is tests/api/eventReads.test.ts.

import { beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { hubDbFrom, HubDbError, POSTGREST_MAX_ROWS, ROW_CAP_CODE } from "../../src/db/forHub.js";
import { readAll } from "../../src/db/readAll.js";
import { inChunks } from "../../src/db/inChunks.js";

let tableSize = 0;
let requests: URL[] = [];

const stub = createClient("http://stub.invalid", "stub-key", {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push(url);
      const method = init?.method ?? "GET";
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : Infinity;
      let rows: Array<{ id: number }> = [];
      if (method === "GET") {
        const end = Math.min(tableSize, offset + Math.min(limit, POSTGREST_MAX_ROWS));
        rows = Array.from({ length: Math.max(0, end - offset) }, (_, i) => ({ id: offset + i }));
      } else {
        // A write returning its rows: as many as were sent.
        const body = JSON.parse(String(init?.body ?? "[]"));
        rows = (Array.isArray(body) ? body : [body]).map((_: unknown, i: number) => ({ id: i }));
      }
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
});

const db = hubDbFrom(stub, "floyd");

beforeEach(() => {
  tableSize = 0;
  requests = [];
});

describe("forHub — a read cut off at the cap", () => {
  it("returns every row of a read under the cap", async () => {
    tableSize = 999;
    expect(await db.from("events").select("id")).toHaveLength(999);
  });

  it("throws when a read with no limit comes back with exactly the cap", async () => {
    tableSize = 1200;
    const err = await db.from("events").select("id").order("created_at").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HubDbError);
    expect((err as HubDbError).code).toBe(ROW_CAP_CODE);
    expect((err as Error).message).toMatch(/events: a read with no limit returned 1000 rows/);
  });

  it("throws for any hub table, filtered or not", async () => {
    tableSize = 5000;
    await expect(db.from("vote_records").select("*").eq("process_id", "p1")).rejects.toThrow(/cap/);
    await expect(db.from("users").select("id").not("digest_frequency", "is", null)).rejects.toThrow(/cap/);
  });

  it("lets a read that asked for a window through, full or not", async () => {
    tableSize = 5000;
    expect(await db.from("events").select("id").limit(1000)).toHaveLength(1000);
    expect(await db.from("events").select("id").range(0, 999)).toHaveLength(1000);
    expect(await db.from("events").select("id").limit(50)).toHaveLength(50);
  });

  it("does not check a write that returns its rows", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `e${i}` }));
    expect(await db.from("events").insert(rows).select("id")).toHaveLength(1000);
  });

  it("does not touch single-row reads or counts", async () => {
    tableSize = 5000;
    await expect(db.from("events").select("id").eq("id", 1).limit(1).maybeSingle()).resolves.toBeTruthy();
  });
});

describe("readAll", () => {
  const page = (from: number, to: number) => db.from("events").select<{ id: number }>("id").order("id").range(from, to);

  it("reads past the cap, in pages, without losing or repeating a row", async () => {
    tableSize = 2345;
    const rows = await readAll(page);
    expect(rows).toHaveLength(2345);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2345);
    expect(rows[2344]).toEqual({ id: 2344 });
    expect(requests).toHaveLength(3);
  });

  it("asks once more after a page that is exactly full", async () => {
    tableSize = 2000;
    expect(await readAll(page)).toHaveLength(2000);
    expect(requests).toHaveLength(3); // 1000, 1000, then the empty page that ends it
  });

  it("reads an empty table in one request", async () => {
    expect(await readAll(page)).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it("honours a smaller page size", async () => {
    tableSize = 250;
    expect(await readAll(page, 100)).toHaveLength(250);
    expect(requests).toHaveLength(3);
  });
});

describe("inChunks", () => {
  it("splits a long id list and joins the answers in order", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => i);
    const seen: number[][] = [];
    const out = await inChunks(ids, async (chunk) => {
      seen.push(chunk);
      return chunk.map((n) => n * 2);
    });
    expect(seen.map((c) => c.length)).toEqual([200, 200, 50]);
    expect(out).toEqual(ids.map((n) => n * 2));
  });

  it("makes no request for an empty list", async () => {
    let called = false;
    expect(await inChunks([], async () => ((called = true), []))).toEqual([]);
    expect(called).toBe(false);
  });
});
