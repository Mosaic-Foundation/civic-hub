// civic.digest/unsubscribe.ts — HMAC-signed unsubscribe tokens.
//
// The token is the credential: no auth required to call /unsubscribe,
// and the link in every digest email is permanent (no expiry — a user
// who clicks the unsubscribe link in an email from 2028 should still be
// able to unsubscribe in 2030). The signing secret (DIGEST_UNSUBSCRIBE_SECRET)
// must persist across deploys; rotating it invalidates every outstanding
// unsubscribe link.
//
// Token layout: base64url(JSON) + "." + base64url(HMAC-SHA256).
// Payload JSON: { uid: <user_id>, p: "unsub_digest" | "unsub_notices" }
// The purpose is signed: a digest link stops the digest only, a notice's link
// stops notices only (design pass, decision 15, 2026-10-29).
//
// MUST NOT reach for the event store or DB. Pure functions + crypto.

import { createHmac, timingSafeEqual } from "node:crypto";

/** What a link stops: the digest (every link before 2026-10-29) or notices. */
export type UnsubscribePurpose = "unsub_digest" | "unsub_notices";

interface TokenPayload {
  uid: string;
  p: UnsubscribePurpose;
}

function b64urlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4;
  const padded = pad ? s + "=".repeat(4 - pad) : s;
  const normalized = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

function sign(payload: string, secret: string): string {
  return b64urlEncode(createHmac("sha256", secret).update(payload).digest());
}

/**
 * Issue a signed unsubscribe token for the given user. Throws if the
 * secret is unset — misconfiguration shouldn't ship invalid links.
 */
export function buildUnsubscribeToken(
  userId: string,
  secret: string,
  purpose: UnsubscribePurpose = "unsub_digest",
): string {
  if (!secret || secret.length < 16) {
    throw new Error(
      "DIGEST_UNSUBSCRIBE_SECRET must be set and >= 16 characters to issue unsubscribe tokens.",
    );
  }
  if (!userId) throw new Error("buildUnsubscribeToken: userId is required");
  const payload: TokenPayload = { uid: userId, p: purpose };
  const encoded = b64urlEncode(JSON.stringify(payload));
  const sig = sign(encoded, secret);
  return `${encoded}.${sig}`;
}

/**
 * Verify a token. Returns the user_id on success, null on any failure
 * (malformed, bad signature, wrong purpose). Timing-safe signature
 * comparison.
 */
export function verifyUnsubscribeToken(
  token: string,
  secret: string,
  purpose: UnsubscribePurpose = "unsub_digest",
): string | null {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = sign(encoded, secret);

  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(encoded).toString("utf8")) as TokenPayload;
  } catch {
    return null;
  }
  if (!payload || payload.p !== purpose) return null;
  if (typeof payload.uid !== "string" || payload.uid.length === 0) return null;
  return payload.uid;
}

/**
 * Build a fully-qualified unsubscribe URL.
 *   base: the hub's API origin (BASE_URL) — the endpoint lives at
 *         {base}/api/unsubscribe/digest?token=…
 *
 * The caller owns whether the link points at /api/unsubscribe/digest
 * (Vercel single-origin) or at a bare /unsubscribe/digest (dev). We
 * always emit the /api prefix: in split-origin dev the backend is
 * mounted at the same origin-relative path as production.
 */
export function buildUnsubscribeUrl(params: {
  userId: string;
  apiBaseUrl: string;
  secret: string;
  /** Notices' link (/unsubscribe/notices) or the digest's (the default). */
  purpose?: UnsubscribePurpose;
}): string {
  const purpose = params.purpose ?? "unsub_digest";
  const token = buildUnsubscribeToken(params.userId, params.secret, purpose);
  const base = params.apiBaseUrl.replace(/\/+$/, "");
  const path = purpose === "unsub_notices" ? "notices" : "digest";
  return `${base}/api/unsubscribe/${path}?token=${encodeURIComponent(token)}`;
}
