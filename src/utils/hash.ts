// Hashing for stored secrets: session tokens, sign-in codes, rate-limit keys.
//
// A secret the server only needs to recognise is stored as its SHA-256, never
// as itself, so a copy of the database (a backup, an export, a leaked row)
// holds nothing anyone can present. The tokens hashed here are 256 random
// bits, so a plain SHA-256 is enough; the six-digit codes are not guessable
// offline either way, because a code lives ten minutes and five tries.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function sameHexHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

/** 256 random bits, URL-safe: a bearer token. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}
