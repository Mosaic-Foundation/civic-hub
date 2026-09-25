// The hub token: a short-lived JWT the server mints for one hub, so that
// PostgREST runs the query as the non-privileged `authenticated` role with a
// `hub_id` claim, and the forced RLS policies (20260925000000) filter on it.
//
// Settled in the Phase 0 spike (BUILD-PLAN-multi-tenant.md → "Phase 3
// approach (verified)"): ES256 with a signing key is the production path; the
// HS256 shared secret behaves identically and is the fallback. PostgREST
// verifies either with the key it is configured with — the Supabase project's
// signing keys when hosted, its own `jwt-secret` when self-hosted. Nothing here
// talks to GoTrue or fetches a JWKS: Supabase Auth is not a dependency.
//
//   CIVIC_HUB_SIGNING_KEY   one of
//     - an EC P-256 private JWK ({ kty:"EC", crv:"P-256", d, x, y, kid }),
//       as `supabase gen signing-key --algorithm ES256` prints it (a
//       one-element array is accepted too)                      → ES256
//     - a symmetric JWK ({ kty:"oct", k })                      → HS256
//     - any other string: the shared secret itself, i.e. PostgREST's
//       `jwt-secret` or a Supabase project's legacy JWT secret  → HS256
//
// The key is server-only. The UI never sees it, or any token minted with it.

import { createHmac, createPrivateKey, createSign, type KeyObject } from "node:crypto";

/**
 * The Postgres role every hub token runs as. It MUST be set: a token with no
 * `role` claim silently becomes `anon` (spike finding 2), which looks like a
 * permissions bug rather than an auth one.
 */
export const HUB_TOKEN_ROLE = "authenticated";

/** Issuer claim, so a hub token is recognisable in PostgREST's logs. */
export const HUB_TOKEN_ISSUER = "civic-hub";

/**
 * Lifetime in seconds. Minted per hub and refreshed well before expiry, so it
 * only has to outlive one request. PostgREST allows ~30 s of skew past `exp`
 * (spike finding 3): this is not a revocation mechanism; suspension is the
 * resolver's job.
 */
export const HUB_TOKEN_TTL_SECONDS = 60;

export interface HubTokenClaims {
  iss: string;
  role: string;
  hub_id: string;
  iat: number;
  exp: number;
}

type Signer =
  | { alg: "ES256"; kid?: string; key: KeyObject }
  | { alg: "HS256"; kid?: string; secret: Buffer };

const b64url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/**
 * Parse CIVIC_HUB_SIGNING_KEY into a signer. Throws with the reason, never
 * with the key.
 */
export function parseSigningKey(raw: string | undefined): Signer {
  const text = raw?.trim();
  if (!text) {
    throw new Error(
      "CIVIC_HUB_SIGNING_KEY is not set. Minted hub tokens need the key PostgREST verifies with " +
        "(an ES256 private JWK, or the HS256 jwt-secret). See .env.example.",
    );
  }
  if (!text.startsWith("{") && !text.startsWith("[")) {
    if (text.length < 32) {
      throw new Error("CIVIC_HUB_SIGNING_KEY: an HS256 secret must be at least 32 characters.");
    }
    return { alg: "HS256", secret: Buffer.from(text, "utf8") };
  }

  let jwk: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text) as unknown;
    const one = Array.isArray(parsed) ? parsed.find((k) => k && typeof k === "object" && "d" in k) ?? parsed[0] : parsed;
    if (!one || typeof one !== "object") throw new Error("not an object");
    jwk = one as Record<string, unknown>;
  } catch {
    throw new Error("CIVIC_HUB_SIGNING_KEY looks like JSON but does not parse as a JWK.");
  }
  const kid = typeof jwk.kid === "string" ? jwk.kid : undefined;

  if (jwk.kty === "EC") {
    if (jwk.crv !== "P-256" || typeof jwk.d !== "string") {
      throw new Error("CIVIC_HUB_SIGNING_KEY: an EC key must be a P-256 PRIVATE JWK (with `d`) for ES256.");
    }
    const key = createPrivateKey({ key: jwk as never, format: "jwk" });
    return { alg: "ES256", kid, key };
  }
  if (jwk.kty === "oct") {
    if (typeof jwk.k !== "string" || jwk.k.length === 0) {
      throw new Error("CIVIC_HUB_SIGNING_KEY: an oct JWK needs `k`.");
    }
    return { alg: "HS256", kid, secret: Buffer.from(jwk.k, "base64url") };
  }
  throw new Error(`CIVIC_HUB_SIGNING_KEY: unsupported key type "${String(jwk.kty)}" (use EC P-256 or oct).`);
}

/** Sign one hub token. Pure apart from the clock; exported for the tests. */
export function signHubToken(
  signer: Signer,
  hubId: string,
  now: number = Math.floor(Date.now() / 1000),
  ttlSeconds: number = HUB_TOKEN_TTL_SECONDS,
): string {
  const header: Record<string, string> = { alg: signer.alg, typ: "JWT" };
  if (signer.kid) header.kid = signer.kid;
  const claims: HubTokenClaims = {
    iss: HUB_TOKEN_ISSUER,
    role: HUB_TOKEN_ROLE,
    hub_id: hubId,
    iat: now,
    exp: now + ttlSeconds,
  };
  const input = `${b64url(header)}.${b64url(claims)}`;
  const signature =
    signer.alg === "ES256"
      ? // JWS wants raw r||s (64 bytes), not DER.
        createSign("SHA256").update(input).sign({ key: signer.key, dsaEncoding: "ieee-p1363" })
      : createHmac("sha256", signer.secret).update(input).digest();
  return `${input}.${signature.toString("base64url")}`;
}

let signer: Signer | null = null;
const tokens = new Map<string, { token: string; refreshAt: number }>();

/**
 * The current token for a hub: minted on first use and again once it is past
 * half its life, so every request carries one with at least 30 s left.
 */
export function hubToken(hubId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const cached = tokens.get(hubId);
  if (cached && now < cached.refreshAt) return cached.token;
  signer ??= parseSigningKey(process.env.CIVIC_HUB_SIGNING_KEY);
  const token = signHubToken(signer, hubId, now);
  tokens.set(hubId, { token, refreshAt: now + Math.floor(HUB_TOKEN_TTL_SECONDS / 2) });
  return token;
}

/** Forget the key and every cached token (tests; a rotated key). */
export function resetHubTokens(): void {
  signer = null;
  tokens.clear();
}
