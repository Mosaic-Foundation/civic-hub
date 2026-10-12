/**
 * An API request no route matches answers in the agreed error shape
 * (BUILD-PLAN "Error responses"): 404, JSON, { error, code }. Before, it got
 * Express's HTML page ("Cannot POST /proposals"). Runs in both API modes.
 */

import { describe, it, expect } from "vitest";
import { api } from "../fixtures/helpers.js";

async function expectJsonNotFound(res: Response): Promise<void> {
  expect(res.status).toBe(404);
  expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/);
  const text = await res.text();
  expect(text).not.toMatch(/<html|<!DOCTYPE|Cannot (GET|POST)/i);
  const body = JSON.parse(text) as Record<string, unknown>;
  expect(body).toEqual({ error: expect.any(String), code: "not_found" });
}

describe("Unknown API routes", () => {
  it("an unknown GET is a JSON 404", async () => {
    await expectJsonNotFound(await api("/no-such-route-anywhere"));
  });

  it("an unknown POST is a JSON 404", async () => {
    await expectJsonNotFound(
      await api("/no-such-route-anywhere/deeper", { method: "POST", body: JSON.stringify({ a: 1 }) }),
    );
  });

  it("other methods too", async () => {
    await expectJsonNotFound(await api("/no-such-route-anywhere", { method: "PUT", body: "{}" }));
    await expectJsonNotFound(await api("/no-such-route-anywhere", { method: "DELETE" }));
  });

  it("the creation routes removed in the conformance session", async () => {
    await expectJsonNotFound(await api("/projects", { method: "POST", body: "{}" }));
  });

  it("a real route still answers", async () => {
    const res = await api("/health");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("ok");
  });
});
