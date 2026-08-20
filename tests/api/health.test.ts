/**
 * Health + discovery endpoint tests.
 *
 * These are the simplest smoke tests — if these fail, nothing else will work.
 */

import { describe, it, expect } from "vitest";
import { apiJson } from "../fixtures/helpers.js";

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
    // No civic geography configured => the key is absent, never null/"none".
    if ("jurisdictions" in body) {
      expect(Array.isArray(body.jurisdictions)).toBe(true);
      expect(body.jurisdictions).not.toContain("local");
      expect(body.jurisdictions).not.toContain("none");
    }
  });
});
