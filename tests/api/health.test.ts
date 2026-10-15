/**
 * Health + discovery endpoint tests.
 *
 * These are the simplest smoke tests — if these fail, nothing else will work.
 */

import { describe, it, expect } from "vitest";
import { apiJson } from "../fixtures/helpers.js";
import { call } from "../fixtures/hostCall.js";

describe("Health and Discovery", () => {
  it("GET /health returns ok status", async () => {
    const { status, body } = await apiJson<{ status: string }>("/health");
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("GET / returns endpoint directory", async () => {
    const { status, body } = await apiJson<{
      name: string;
      version: string;
      endpoints: Record<string, string>;
    }>("/");
    expect(status).toBe(200);
    expect(body.name).toBe("Civic Hub");
    expect(body.endpoints).toBeDefined();
    expect(Object.keys(body.endpoints).length).toBeGreaterThan(0);
  });

  it("GET /.well-known/civic.json returns the Space-spec discovery manifest", async () => {
    const { status, body } = await apiJson<{
      name: string;
      space: { id: string; scope: string; type: string };
      jurisdictions?: string[];
      feeds: string[];
      processes: string[];
      spec: Record<string, string>;
    }>("/.well-known/civic.json");
    expect(status).toBe(200);
    expect(body.name).toBeTruthy();
    // The space is identified by its DID — the key that survives migration.
    expect(body.space).toBeDefined();
    expect(body.space.id).toMatch(/^did:/);
    expect(body.space.scope).toBe("community");
    expect(body.space.type).toBe("civic.hub");
    expect(Array.isArray(body.feeds)).toBe(true);
    expect(body.feeds.some((f) => f.endsWith("/events"))).toBe(true);
    expect(Array.isArray(body.processes)).toBe(true);
    expect(body.spec.activity).toBe("civic-activity-spec-v0.2");
    // Spec §6.3: "A conformance claim names its level." Level 2 adds
    // ActivityPub delivery, which this hub does not implement.
    expect(body.spec.conformance).toBe("level-1");
    // No civic geography configured => the key is absent, never null/"none".
    if ("jurisdictions" in body) {
      expect(Array.isArray(body.jurisdictions)).toBe(true);
      expect(body.jurisdictions).not.toContain("local");
      expect(body.jurisdictions).not.toContain("none");
    }
  });
});

// Audit 4: /health names the database functions the code calls
// (src/db/functionContract.ts) and checks them against the live catalog through
// public.function_catalog(). LOCAL ONLY for the catalog part (pg on the stack).
describe("Health checks the database functions", () => {
  it("GET /health counts the functions among what it checked", async () => {
    const { FUNCTION_CONTRACT } = await import("../../src/db/functionContract.js");
    const { status, body } = await apiJson<{ status: string; schema: { ok: boolean; checked: number; gaps: string[] } }>(
      "/health",
    );
    expect(status).toBe(200);
    expect(body.schema.ok).toBe(true);
    expect(body.schema.gaps).toEqual([]);
    expect(body.schema.checked).toBeGreaterThan(FUNCTION_CONTRACT.length);
  });

  it("the catalog finds a function behind the code, and two versions of one", async () => {
    const pg = (await import("pg")).default;
    const { compareFunctions, FUNCTION_CONTRACT } = await import("../../src/db/functionContract.js");
    const url = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
    if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("health: local stack only");
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    const catalog = async () =>
      (await db.query("SELECT * FROM public.function_catalog($1)", [FUNCTION_CONTRACT.map((f) => f.name)])).rows;
    try {
      expect(compareFunctions(FUNCTION_CONTRACT, await catalog())).toEqual([]);
      // In a transaction rolled back at the end: nothing is left behind.
      await db.query("BEGIN");
      // A database still on Audit 2's transition_process (the dev incident).
      await db.query(
        "DROP FUNCTION public.transition_process(text, text, text, text, jsonb, jsonb, text, bigint, jsonb)",
      );
      await db.query(
        `CREATE FUNCTION public.transition_process(p_hub_id text, p_process_id text, p_to_status text, p_actor text, p_event jsonb, p_state jsonb DEFAULT NULL)
         RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$`,
      );
      // And a second version of another.
      await db.query(
        "CREATE FUNCTION public.reshuffle_ballots(p_hub_id text, p_process_id text, p_extra integer) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$",
      );
      const gaps = compareFunctions(FUNCTION_CONTRACT, await catalog());
      expect(gaps.map((g) => [g.name, g.kind])).toEqual([
        ["transition_process", "mismatched_function"],
        ["reshuffle_ballots", "overloaded_function"],
      ]);
    } finally {
      await db.query("ROLLBACK").catch(() => {});
      await db.end();
    }
  });

  it("the catalog is the service role's only", async () => {
    // Asked of the catalog, not by calling it as anon: on the local Supabase
    // image (postgres 17.6.1.111) a call to a function the role may not
    // execute crashes the database backend (signal 11; TESTING.md, Audit 4).
    const pg = (await import("pg")).default;
    const db = new pg.Client({
      connectionString: process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });
    await db.connect();
    try {
      const { rows } = await db.query(
        `SELECT r.rolname, has_function_privilege(r.rolname, 'public.function_catalog(text[])', 'EXECUTE') AS can
           FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'service_role') ORDER BY 1`,
      );
      expect(rows).toEqual([
        { rolname: "anon", can: false },
        { rolname: "authenticated", can: false },
        { rolname: "service_role", can: true },
      ]);
    } finally {
      await db.end();
    }
  });
});

// Operations shell: uptime monitoring reads the status code of /health on
// every hub and on the console, and the browser's error reports post here.
describe("Health for monitors, and the browser's error reports", () => {
  it("answers on the console's hostname too, and is never cached", async () => {
    for (const host of ["floyd.civic.social", "console.localhost"]) {
      const res = await call("GET", "/health", host);
      expect(res.status, host).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.schema.gaps).toEqual([]);
      expect(res.headers["cache-control"]).toBe("no-store");
    }
  });

  it("POST /client-errors answers 204 for a report, for nonsense and for a body too large", async () => {
    const report = { name: "TypeError", message: "x is undefined", stack: "TypeError: x\n    at f (a.js:1:1)", path: "/", surface: "hub" };
    expect((await call("POST", "/client-errors", "floyd.civic.social", report)).status).toBe(204);
    expect((await call("POST", "/client-errors", "console.localhost", { ...report, surface: "console" })).status).toBe(204);
    expect((await call("POST", "/client-errors", "floyd.civic.social", { nonsense: true })).status).toBe(204);
    expect((await call("POST", "/client-errors", "floyd.civic.social", { message: "x".repeat(40_000) })).status).toBe(204);
  });
});
