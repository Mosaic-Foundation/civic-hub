// Audit 2, A8 (2026-10-11): the debug seed is an admin's POST, and every API
// response carries the security headers. On the dev hub (Athens), read-only:
// nothing here seeds.

import { describe, expect, it } from "vitest";
import { api, getResidentToken, authHeaders } from "../fixtures/helpers.js";
import { API_SECURITY_HEADERS } from "../../src/shared/securityHeaders.js";

describe("the debug seed", () => {
  it("is not a GET any more", async () => {
    expect((await api("/debug/seed")).status).toBe(404);
  });

  it("is refused to the signed-out and to a resident", async () => {
    expect((await api("/debug/seed", { method: "POST" })).status).toBe(401);
    const resident = await getResidentToken();
    expect((await api("/debug/seed", { method: "POST", headers: authHeaders(resident) })).status).toBe(403);
  });
});

describe("security headers on the API", () => {
  it("are on a JSON response and on an error", async () => {
    for (const path of ["/health", "/no-such-route"]) {
      const res = await api(path);
      for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
        // Express's own 404 page replaces the policy with a stricter one
        // (default-src 'none' and nothing else), which is fine.
        if (name === "Content-Security-Policy" && path === "/no-such-route") {
          expect(res.headers.get(name)).toMatch(/^default-src 'none'/);
          continue;
        }
        expect(res.headers.get(name), `${path} ${name}`).toBe(value);
      }
    }
  });
});
