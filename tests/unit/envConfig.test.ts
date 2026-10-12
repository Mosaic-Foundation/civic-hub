// The one config module (Audit 4, F7): reads at access time, trims, treats
// empty as unset; development flags stay refused in production (Audit 2).

import { afterEach, describe, expect, it } from "vitest";
import { env, envVar, isProductionEnv } from "../../src/config/env.js";
import { privateFetchAllowed, rateLimitsEnabled, seedAllowed } from "../../src/config/devFlags.js";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("env", () => {
  it("reads at access time, trimmed; empty is unset", () => {
    process.env.HUB_NAME = "  Somewhere  ";
    expect(env.HUB_NAME).toBe("Somewhere");
    process.env.HUB_NAME = "   ";
    expect(env.HUB_NAME).toBeUndefined();
    delete process.env.HUB_NAME;
    expect(env.HUB_NAME).toBeUndefined();
    process.env.CIVIC_ADMIN_EMAILS = " a@example.test ";
    expect(envVar("CIVIC_ADMIN_EMAILS")).toBe("a@example.test");
  });

  it("development flags are refused under NODE_ENV=production", () => {
    process.env.CIVIC_ALLOW_SEED = "true";
    process.env.CIVIC_RATE_LIMITS = "off";
    process.env.CIVIC_SSRF_ALLOW_PRIVATE = "true";
    process.env.NODE_ENV = "development";
    expect([seedAllowed(), rateLimitsEnabled(), privateFetchAllowed()]).toEqual([true, false, true]);
    process.env.NODE_ENV = "production";
    expect(isProductionEnv()).toBe(true);
    expect([seedAllowed(), rateLimitsEnabled(), privateFetchAllowed()]).toEqual([false, true, false]);
  });
});
