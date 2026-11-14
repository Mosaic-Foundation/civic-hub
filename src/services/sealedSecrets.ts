// Secrets a hub keeps in its own database, sealed with a deployment secret
// (the fediverse feature, 2026-11-13). A hub's fediverse signing keys say
// "this is the hub" to every server that follows it, so a copy of the
// database alone (a backup, an export) must not be enough to speak as the
// hub. Each value is sealed with AES-256-GCM under a key derived from
// CIVIC_FEDIVERSE_SECRET, with the hub's id as associated data, so a sealed
// value copied to another hub's row does not open there either.
//
// Outside production an unset secret falls back to a fixed development key,
// so the local stack and CI work without one. In production an unset or
// short secret means nothing seals or opens: sealingAvailable() is false and
// the feature that needs it stays silent.

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { env, isProductionEnv } from "../config/env.js";

const VERSION = "v1";
/** DEVELOPMENT ONLY: never used when NODE_ENV=production. */
const DEV_SECRET = "civic-hub-development-only-fediverse-secret";
const MIN_LENGTH = 32;

function secret(): string | null {
  const s = env.CIVIC_FEDIVERSE_SECRET;
  if (s && s.length >= MIN_LENGTH) return s;
  return isProductionEnv() ? null : DEV_SECRET;
}

/** Whether this deployment can seal and open secrets. */
export function sealingAvailable(): boolean {
  return secret() !== null;
}

/** Which secret sealed a value, without saying what it is: 8 hex characters. */
export function sealingKeyId(): string | null {
  const s = secret();
  return s ? createHash("sha256").update(`civic-sealed-secrets:${s}`).digest("hex").slice(0, 8) : null;
}

function keyFor(purpose: string): Buffer {
  const s = secret();
  if (!s) throw new Error("CIVIC_FEDIVERSE_SECRET is not set: nothing can be sealed or opened");
  return Buffer.from(hkdfSync("sha256", s, "civic-sealed-secrets", purpose, 32));
}

/** `plaintext`, sealed for `purpose` on hub `hubId`: "v1.<keyid>.<iv>.<ciphertext>.<tag>", base64url. */
export function seal(purpose: string, hubId: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(purpose), iv);
  cipher.setAAD(Buffer.from(hubId, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, sealingKeyId(), iv.toString("base64url"), ct.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

/** What seal() sealed. Throws when the secret, the purpose or the hub differs, or the value was changed. */
export function open(purpose: string, hubId: string, sealed: string): string {
  const [version, , iv, ct, tag] = sealed.split(".");
  if (version !== VERSION || !iv || !ct || !tag) throw new Error("Not a sealed value");
  const decipher = createDecipheriv("aes-256-gcm", keyFor(purpose), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(hubId, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
