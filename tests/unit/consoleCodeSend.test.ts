// A console code whose email cannot be sent counts for nothing (plugin
// session 2): with a mailer configured that fails, the code is withdrawn, the
// attempts it was counted against are given back, and the operator is told
// rather than left waiting. With no mailer at all (local development) the
// code goes to the log, as before. In-memory limiter, code store and mailer.

import { beforeEach, describe, expect, it, vi } from "vitest";

const OPERATOR = "operator@example.test";
const hits: string[] = [];
const codes: Array<{ purpose: string; code_hash: string }> = [];
const mail = { configured: true, fail: true };

// The console's own limiter (src/control/rateLimits.ts; the console split, step 3b).
vi.mock("../../src/control/rateLimits.js", async (orig) => {
  const real = await orig<typeof import("../../src/control/rateLimits.js")>();
  return {
    ...real,
    consoleRateLimits: {
      rateLimitBucket: real.consoleRateLimits.rateLimitBucket,
      takeRateLimit: async (checks: Array<{ scope: string }>) => {
        for (const c of checks) hits.push(c.scope);
        return null;
      },
      rateLimitRetryAt: async () => null,
      release: async (checks: Array<{ scope: string }>) => {
        for (const c of checks) hits.splice(hits.lastIndexOf(c.scope), 1);
      },
    },
  };
});
vi.mock("../../src/control/config.js", async (orig) => ({
  ...(await orig<typeof import("../../src/control/config.js")>()),
  consoleAdminEmail: () => ({ ok: true, email: OPERATOR }),
}));
vi.mock("../../src/utils/email.js", async (orig) => ({
  ...(await orig<typeof import("../../src/utils/email.js")>()),
  mailConfigured: () => mail.configured,
  sendEmail: async () => (mail.fail ? { sent: false, error: "provider down" } : { sent: true, id: "m1" }),
}));
vi.mock("../../src/control/platformCodes.js", async (orig) => ({
  ...(await orig<typeof import("../../src/control/platformCodes.js")>()),
  platformCodeStore: (_realm: string, purpose: string) => ({
    live: async () => codes.filter((c) => c.purpose === purpose).map(() => new Date(Date.now() + 600_000).toISOString()),
    insert: async (row: { code_hash: string }) => void codes.push({ purpose, code_hash: row.code_hash }),
    take: async () => [],
    spend: async () => true,
  }),
  withdrawPlatformCode: async (_realm: string, purpose: string, _email: string, codeHash: string) => {
    const i = codes.findIndex((c) => c.purpose === purpose && c.code_hash === codeHash);
    if (i >= 0) codes.splice(i, 1);
  },
}));

// The code rules take the console's limiter from its realm (platformRealm), so the mock above is the one they use.
const { requestCode } = await import("../../src/control/auth.js");

beforeEach(() => {
  hits.length = 0;
  codes.length = 0;
  mail.configured = true;
  mail.fail = true;
});

describe("a console code whose email cannot be sent", () => {
  it("is withdrawn, counts for nothing, and the operator is told", async () => {
    await expect(requestCode(OPERATOR, "step_up", "198.51.100.7")).rejects.toMatchObject({
      status: 502,
      message: "The code email could not be sent just now, and nothing was counted. Try again in a moment.",
    });
    expect(codes).toEqual([]);
    expect(hits).toEqual([]);
  });

  it("when it is sent, the request is counted once against the IP, the minute and the hour", async () => {
    mail.fail = false;
    await requestCode(OPERATOR, "step_up", "198.51.100.7");
    expect(codes).toHaveLength(1);
    expect(hits.sort()).toEqual(["console.code_email", "console.new_code", "console.request_code"]);
  });

  it("with no mailer at all (local development) the code is kept and goes to the log, as before", async () => {
    mail.configured = false;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await requestCode(OPERATOR, "step_up", "198.51.100.7");
    expect(codes).toHaveLength(1);
    expect(log.mock.calls.flat().join(" ")).toMatch(/step_up code for operator@example\.test: \d{6}/);
    log.mockRestore();
  });
});
