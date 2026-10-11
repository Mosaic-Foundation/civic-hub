// Audit 2, A8: the UI's security headers are written twice, in
// src/shared/securityHeaders.ts (the API, vite preview) and in vercel.json
// (production's pages). They must be the same.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { API_SECURITY_HEADERS, CONTENT_SECURITY_POLICY, UI_SECURITY_HEADERS } from "../../src/shared/securityHeaders.js";

const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
  headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};

describe("security headers", () => {
  it("vercel.json serves exactly UI_SECURITY_HEADERS on every page but /api", () => {
    const block = vercel.headers?.find((h) => h.source === "/((?!api/|api$).*)");
    expect(block, "vercel.json has the headers block").toBeTruthy();
    expect(Object.fromEntries(block!.headers.map((h) => [h.key, h.value]))).toEqual(UI_SECURITY_HEADERS);
  });

  it("allows no script but the bundle's, and no framing either way", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-src 'none'");
    expect(API_SECURITY_HEADERS["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(UI_SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(UI_SECURITY_HEADERS["Strict-Transport-Security"]).toMatch(/max-age=\d{8}/);
  });
});
