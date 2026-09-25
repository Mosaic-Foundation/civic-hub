// Phase 3, step 2: the minted hub token and the switch that turns it on.
//
// No database: signatures are verified here with node:crypto against the
// public half of the key, which is what PostgREST does with the key it holds.
// That PostgREST accepts these tokens, and that RLS then filters on them, is
// proven against the local stack by tests/api/leakHarness.test.ts.

import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HUB_TOKEN_ROLE,
  HUB_TOKEN_TTL_SECONDS,
  hubToken,
  parseSigningKey,
  resetHubTokens,
  signHubToken,
} from "../../src/db/hubToken.js";

const HS_SECRET = "a-test-only-secret-that-is-at-least-32-characters";

function decode(token: string) {
  const [h, p, s] = token.split(".");
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString()),
    claims: JSON.parse(Buffer.from(p, "base64url").toString()),
    input: `${h}.${p}`,
    signature: Buffer.from(s, "base64url"),
  };
}

function ecKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...privateKey.export({ format: "jwk" }), kid: "test-kid", alg: "ES256" };
  return { jwk, publicKey };
}

describe("hub token claims", () => {
  it("always carries role=authenticated, the hub, an issuer and a 60 s expiry", () => {
    const t = decode(signHubToken(parseSigningKey(HS_SECRET), "athens", 1_000));
    // A missing role would silently run as anon (spike finding 2).
    expect(t.claims.role).toBe(HUB_TOKEN_ROLE);
    expect(t.claims.role).toBe("authenticated");
    expect(t.claims.hub_id).toBe("athens");
    expect(t.claims.iss).toBe("civic-hub");
    expect(t.claims.iat).toBe(1_000);
    expect(t.claims.exp).toBe(1_000 + HUB_TOKEN_TTL_SECONDS);
    expect(HUB_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(60);
  });

  it("never names a privileged role", () => {
    for (const hub of ["floyd", "athens"]) {
      const { claims } = decode(signHubToken(parseSigningKey(HS_SECRET), hub));
      expect(["service_role", "postgres", "supabase_admin", "anon"]).not.toContain(claims.role);
    }
  });
});

describe("signing keys", () => {
  it("ES256 from an EC private JWK: verifies with the public key, raw r||s, kid in the header", () => {
    const { jwk, publicKey } = ecKey();
    const t = decode(signHubToken(parseSigningKey(JSON.stringify(jwk)), "floyd"));
    expect(t.header).toEqual({ alg: "ES256", typ: "JWT", kid: "test-kid" });
    expect(t.signature.length).toBe(64);
    const ok = createVerify("SHA256")
      .update(t.input)
      .verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, t.signature);
    expect(ok).toBe(true);
  });

  it("accepts the CLI's array form", () => {
    const { jwk } = ecKey();
    expect(parseSigningKey(JSON.stringify([jwk])).alg).toBe("ES256");
  });

  it("HS256 from a raw secret (PostgREST jwt-secret / legacy project secret)", () => {
    const t = decode(signHubToken(parseSigningKey(HS_SECRET), "floyd"));
    expect(t.header).toEqual({ alg: "HS256", typ: "JWT" });
    const expected = createHmac("sha256", HS_SECRET).update(t.input).digest();
    expect(t.signature.equals(expected)).toBe(true);
  });

  it("HS256 from an oct JWK", () => {
    const k = Buffer.from(HS_SECRET).toString("base64url");
    const t = decode(signHubToken(parseSigningKey(JSON.stringify({ kty: "oct", k, kid: "o1" })), "floyd"));
    expect(t.header.alg).toBe("HS256");
    expect(t.header.kid).toBe("o1");
    expect(t.signature.equals(createHmac("sha256", HS_SECRET).update(t.input).digest())).toBe(true);
  });

  it("refuses a missing key, a short secret, a public-only EC key and other key types — without echoing the key", () => {
    expect(() => parseSigningKey(undefined)).toThrow(/CIVIC_HUB_SIGNING_KEY is not set/);
    expect(() => parseSigningKey("  ")).toThrow(/not set/);
    expect(() => parseSigningKey("short-secret")).toThrow(/at least 32/);
    const { jwk } = ecKey();
    const { d: _d, ...publicOnly } = jwk as Record<string, unknown>;
    expect(() => parseSigningKey(JSON.stringify(publicOnly))).toThrow(/PRIVATE JWK/);
    expect(() => parseSigningKey(JSON.stringify({ kty: "RSA", n: "x", e: "AQAB" }))).toThrow(/unsupported/);
    expect(() => parseSigningKey("{not json")).toThrow(/does not parse/);
    try {
      parseSigningKey("short-secret");
    } catch (e) {
      expect(String(e)).not.toContain("short-secret");
    }
  });
});

describe("hubToken(): per hub, refreshed at half-life", () => {
  beforeEach(() => {
    resetHubTokens();
    process.env.CIVIC_HUB_SIGNING_KEY = HS_SECRET;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CIVIC_HUB_SIGNING_KEY;
    resetHubTokens();
  });

  it("one token per hub, each naming its own hub", () => {
    const a = hubToken("athens");
    const f = hubToken("floyd");
    expect(a).not.toBe(f);
    expect(decode(a).claims.hub_id).toBe("athens");
    expect(decode(f).claims.hub_id).toBe("floyd");
  });

  it("reuses a token for less than half its life, then mints a fresh one", () => {
    const first = hubToken("athens");
    vi.advanceTimersByTime((HUB_TOKEN_TTL_SECONDS / 2 - 1) * 1000);
    expect(hubToken("athens")).toBe(first);
    vi.advanceTimersByTime(2000);
    const second = hubToken("athens");
    expect(second).not.toBe(first);
    // Every token handed out has at least half its life left.
    const { claims } = decode(second);
    expect(claims.exp - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(HUB_TOKEN_TTL_SECONDS / 2);
  });
});

describe("the CIVIC_HUB_MINTED_TOKEN switch", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    process.env.CIVIC_HUB_SIGNING_KEY = HS_SECRET;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("defaults off: forHub() stays on the service role", async () => {
    delete process.env.CIVIC_HUB_MINTED_TOKEN;
    const { hubDbMode } = await import("../../src/db/forHub.js");
    expect(hubDbMode()).toBe("service_role");
    process.env.CIVIC_HUB_MINTED_TOKEN = "false";
    expect(hubDbMode()).toBe("service_role");
  });

  it("on: forHub() uses a hub token client, read on every call, so it turns off without a restart", async () => {
    const { forHub, hubDbMode } = await import("../../src/db/forHub.js");
    process.env.CIVIC_HUB_MINTED_TOKEN = "true";
    expect(hubDbMode()).toBe("hub_token");
    const tokenDb = forHub("athens");
    process.env.CIVIC_HUB_MINTED_TOKEN = "";
    expect(hubDbMode()).toBe("service_role");
    const serviceDb = forHub("athens");
    expect(serviceDb).not.toBe(tokenDb);
    process.env.CIVIC_HUB_MINTED_TOKEN = "1";
    expect(forHub("athens")).toBe(tokenDb);
  });

  it("on with no signing key: fails loudly at the first forHub(), not silently as anon", async () => {
    delete process.env.CIVIC_HUB_SIGNING_KEY;
    process.env.CIVIC_HUB_MINTED_TOKEN = "true";
    const { forHub } = await import("../../src/db/forHub.js");
    expect(() => forHub("athens")).toThrow(/CIVIC_HUB_SIGNING_KEY is not set/);
  });

  it("operator scripts are pinned to the service role whatever the flag says", async () => {
    process.env.CIVIC_HUB_MINTED_TOKEN = "true";
    await import("../../scripts/lib/hubScope.js");
    const { hubDbMode } = await import("../../src/db/forHub.js");
    expect(hubDbMode()).toBe("service_role");
  });
});
