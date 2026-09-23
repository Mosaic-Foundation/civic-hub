/**
 * Auth endpoint tests.
 *
 * Tests the email-based auth flow: request code → verify → get user.
 * Uses the demo bypass code (CIVIC_DEMO_BYPASS_CODE=000000).
 */

import { describe, it, expect } from "vitest";
import { apiJson, api, authHeaders } from "../fixtures/helpers.js";

describe("Auth endpoints", () => {
  const testEmail = `test-auth-${Date.now()}@civic.social`;

  it("POST /auth/request-code accepts an email", async () => {
    const { status, body } = await apiJson<{ message: string }>(
      "/auth/request-code",
      {
        method: "POST",
        body: JSON.stringify({ email: testEmail }),
      },
    );
    expect(status).toBe(200);
    expect(body.message).toBeDefined();
  });

  it("POST /auth/request-code rejects invalid email", async () => {
    const { status } = await apiJson("/auth/request-code", {
      method: "POST",
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(status).toBe(400);
  });

  it("POST /auth/verify creates user and returns token", async () => {
    await api("/auth/request-code", {
      method: "POST",
      body: JSON.stringify({ email: testEmail }),
    });

    const { status, body } = await apiJson<{
      token: string;
      user: { id: string; email: string; is_resident: boolean };
    }>("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ email: testEmail, code: "000000" }),
    });

    expect(status).toBe(200);
    expect(body.token).toBeDefined();
    expect(body.user.email).toBe(testEmail);
    expect(body.user.is_resident).toBe(false);
  });

  it("POST /auth/verify rejects a malformed code", async () => {
    // WHAT CHANGED, 2026-09-22. This used to assert that "999999" was
    // rejected, and it passed because the local hub had a demo bypass code
    // that had to match exactly. A demo hub now accepts ANY six digits, by
    // design: there is no shared code to display or leak, so a demo has
    // nothing to guess. Six digits therefore signs in here, and asserting
    // otherwise would be asserting the old design.
    //
    // What is still true on a demo hub, and worth holding, is that the code
    // has to look like a code. An empty or malformed submission does not walk
    // in.
    //
    // COVERAGE GAP, stated rather than hidden: the security-relevant case — a
    // wrong code rejected on a hub that is NOT a demo — is not exercised
    // here. This suite talks to the server over HTTP only, so it cannot read
    // the real one-time code out of pending_verifications to supply a
    // genuinely wrong one against a live hub. Closing it needs a fixture hub
    // in beta or live mode plus database access from the test. See HANDOFF.
    const wrongEmail = `wrong-code-${Date.now()}@civic.social`;
    await api("/auth/request-code", {
      method: "POST",
      body: JSON.stringify({ email: wrongEmail }),
    });

    for (const code of ["", "12345", "1234567", "abcdef"]) {
      const { status } = await apiJson("/auth/verify", {
        method: "POST",
        body: JSON.stringify({ email: wrongEmail, code }),
      });
      expect(status, `code "${code}" should be refused`).toBe(400);
    }
  });

  it("GET /auth/me returns current user when authenticated", async () => {
    // Sign in fresh
    const freshEmail = `test-me-${Date.now()}@civic.social`;
    await api("/auth/request-code", {
      method: "POST",
      body: JSON.stringify({ email: freshEmail }),
    });
    const { body: verifyBody } = await apiJson<{ token: string }>(
      "/auth/verify",
      {
        method: "POST",
        body: JSON.stringify({ email: freshEmail, code: "000000" }),
      },
    );

    // GET /auth/me wraps user in { user: {...} }
    const { status, body } = await apiJson<{
      user: { id: string; email: string };
    }>("/auth/me", { headers: authHeaders(verifyBody.token) });

    expect(status).toBe(200);
    expect(body.user.email).toBe(freshEmail);
  });

  it("GET /auth/me returns 401 without token", async () => {
    const { status } = await apiJson("/auth/me");
    expect(status).toBe(401);
  });

  it("POST /auth/residency affirms residency", async () => {
    // Sign in fresh
    const resEmail = `test-residency-${Date.now()}@civic.social`;
    await api("/auth/request-code", {
      method: "POST",
      body: JSON.stringify({ email: resEmail }),
    });
    const { body: verifyBody } = await apiJson<{ token: string }>(
      "/auth/verify",
      {
        method: "POST",
        body: JSON.stringify({ email: resEmail, code: "000000" }),
      },
    );

    // POST /auth/residency wraps user in { user: {...} }
    const { status, body } = await apiJson<{
      user: { is_resident: boolean };
    }>("/auth/residency", {
      method: "POST",
      headers: authHeaders(verifyBody.token),
      // full_name is required for an account that doesn't have one yet.
      body: JSON.stringify({ affirm: true, full_name: "Test Resident" }),
    });

    expect(status).toBe(200);
    expect(body.user.is_resident).toBe(true);
  });
});
