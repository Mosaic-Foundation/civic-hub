// Signed approvals (plugin session 2, ADR-015). An approved catalog row
// records, beside the hash of a package's files, a signature over
// (package, version, hash, grant) made with the Mosaic catalog key when the
// operator approves it in the console. The loader verifies the signature as
// well as the hash, so an approval written into the table by anything but the
// console (a migration, a stolen database key) mounts nothing once
// signatures are required.
//
// The key: Ed25519, Node's own crypto, no dependency. CIVIC_CATALOG_SIGNING_KEY
// holds the private key (a hosting setting, one per deployment, never in a
// file or a chat); the loader verifies with its public half. A key is named by
// its id, "ed25519:" and the first 16 hex characters of the sha256 of its
// public key (DER), and the id is stored beside each signature.
//
// Rotation: a new key in CIVIC_CATALOG_SIGNING_KEY, the old public key in
// CIVIC_CATALOG_TRUSTED_KEYS, "Sign approved entries" in the console (it signs
// every approved row not signed by the current key), then the old one leaves
// the trusted list.
//
// The mode (CIVIC_CATALOG_SIGNATURES):
//   transition (the default while the shipped rows are signed): a signed row
//     must verify; an unsigned approved row still mounts on its hash; a
//     deployment without a key mounts on hashes alone.
//   required: a row without a valid signature is unapproved, and a deployment
//     without a key mounts nothing.
//
// tests/fixtures/catalog/test-signing-key.pem is a committed key for the local
// stack and CI. It is refused on every deployment (NODE_ENV=production).

import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { env, isProductionEnv } from "../config/env.js";
import type { PluginCapabilities } from "../shared/pluginGrant.js";

/** The committed test key's public half (tests/fixtures/catalog/test-signing-key.pem): refused on a deployment. */
export const TEST_KEY_PUBLIC = "MCowBQYDK2VwAyEAqL0w/RwmbGgV5n2yWqG4RCvlkB4Spn1Zbb4niXH0QAM=";

export type SignatureMode = "transition" | "required";

/** What a signature covers. */
export interface SignedFields {
  package: string;
  version: string;
  hash: string;
  capabilities: PluginCapabilities;
}

export interface Signature {
  signature: string;
  signature_key: string;
}

export interface SigningKey {
  id: string;
  /** The public half, base64 DER: what CIVIC_CATALOG_TRUSTED_KEYS takes after a rotation. */
  publicKey: string;
  privateKey: KeyObject;
}

/** The bytes signed: (package, version, hash, grant) as canonical JSON, keys sorted at every level. */
export function signedBytes(row: SignedFields): Buffer {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
        : v;
  return Buffer.from(
    JSON.stringify(canonical({ package: row.package, version: row.version, hash: row.hash, grant: row.capabilities })),
    "utf8",
  );
}

/** A public key's id. */
export function keyId(publicKey: KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" });
  return `ed25519:${createHash("sha256").update(der).digest("hex").slice(0, 16)}`;
}

function publicDer(key: KeyObject): string {
  return key.export({ type: "spki", format: "der" }).toString("base64");
}

export class SigningKeyError extends Error {}

/** Read a private key setting: its PEM, or that PEM in base64 (one line, for a host that keeps no newlines). */
export function parseSigningKey(value: string, production = isProductionEnv()): SigningKey {
  const pem = value.includes("BEGIN") ? value : Buffer.from(value, "base64").toString("utf8");
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(pem.replace(/\\n/g, "\n"));
  } catch {
    throw new SigningKeyError("CIVIC_CATALOG_SIGNING_KEY is not a private key in PEM.");
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new SigningKeyError(`CIVIC_CATALOG_SIGNING_KEY is an ${privateKey.asymmetricKeyType} key; the catalog signs with Ed25519.`);
  }
  const publicKey = createPublicKey(privateKey);
  if (production && publicDer(publicKey) === TEST_KEY_PUBLIC) {
    throw new SigningKeyError("CIVIC_CATALOG_SIGNING_KEY is the committed test key, which a deployment refuses.");
  }
  return { id: keyId(publicKey), publicKey: publicDer(publicKey), privateKey };
}

/** The keys a deployment signs and verifies with, from its settings. Exported for tests (they pass their own). */
export interface CatalogKeys {
  mode: SignatureMode;
  /** This deployment's signing key, or null when it has none. */
  signing: SigningKey | null;
  /** Every key a signature may verify against, by id: the signing key's public half and the trusted ones. */
  trusted: Map<string, KeyObject>;
  /** Why the key setting could not be used, when it was set and refused. */
  problem?: string;
}

export function catalogKeys(settings: {
  key?: string;
  trusted?: string;
  mode?: string;
  production?: boolean;
} = { key: env.CIVIC_CATALOG_SIGNING_KEY, trusted: env.CIVIC_CATALOG_TRUSTED_KEYS, mode: env.CIVIC_CATALOG_SIGNATURES }): CatalogKeys {
  const production = settings.production ?? isProductionEnv();
  // An unknown mode fails safe: it is read as required.
  const mode: SignatureMode = (settings.mode ?? "transition").trim() === "transition" ? "transition" : "required";
  const trusted = new Map<string, KeyObject>();
  let signing: SigningKey | null = null;
  let problem: string | undefined;
  if (settings.key) {
    try {
      signing = parseSigningKey(settings.key, production);
      trusted.set(signing.id, createPublicKey(signing.privateKey));
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err);
    }
  }
  for (const entry of (settings.trusted ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    try {
      const pub = createPublicKey({ key: Buffer.from(entry, "base64"), format: "der", type: "spki" });
      if (production && entry === TEST_KEY_PUBLIC) continue;
      if (pub.asymmetricKeyType === "ed25519") trusted.set(keyId(pub), pub);
    } catch {
      problem ??= "CIVIC_CATALOG_TRUSTED_KEYS has an entry that is not a public key (base64 DER).";
    }
  }
  return { mode, signing, trusted, ...(problem ? { problem } : {}) };
}

let cached: CatalogKeys | null = null;

/** This deployment's keys, read once. */
export function deploymentKeys(): CatalogKeys {
  return (cached ??= catalogKeys());
}

/** Forget the keys read (tests that change the settings). */
export function resetDeploymentKeys(): void {
  cached = null;
}

/** Sign a row's fields with a key. */
export function signRow(row: SignedFields, key: SigningKey): Signature {
  return { signature: sign(null, signedBytes(row), key.privateKey).toString("base64"), signature_key: key.id };
}

/** Whether a row's signature verifies against one of the trusted keys. */
export function signatureVerifies(
  row: SignedFields & { signature?: string | null; signature_key?: string | null },
  trusted: ReadonlyMap<string, KeyObject>,
): boolean {
  if (!row.signature || !row.signature_key) return false;
  const pub = trusted.get(row.signature_key);
  if (!pub) return false;
  try {
    return verify(null, signedBytes(row), pub, Buffer.from(row.signature, "base64"));
  } catch {
    return false;
  }
}
