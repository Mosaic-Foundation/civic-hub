// Signed approvals (plugin session 2, ADR-015), the hub's side: verifying.
// An approved catalog row records, beside the hash of a package's files, a
// signature over (package, version, hash, grant) made with the Mosaic catalog
// key when the operator approves it in the console. The loader verifies the
// signature as well as the hash, so an approval written into the table by
// anything but the console (a migration, a stolen database key) mounts
// nothing once signatures are required.
//
// The console split (2026-11-10): the hub holds only the public half. The
// private key is the console's (Mosaic-Foundation/mosaic-console); the bytes
// and the checks are shared (src/shared/catalogSignature.ts).
//
// The keys the hub trusts:
//   CIVIC_CATALOG_PUBLIC_KEY   the console's key, its public half (base64
//                              DER, as the console's Plugins page shows it).
//   CIVIC_CATALOG_TRUSTED_KEYS retired keys still trusted during a rotation.
//
// Rotation: a new key in the console, its public half in
// CIVIC_CATALOG_PUBLIC_KEY with the old one in CIVIC_CATALOG_TRUSTED_KEYS,
// "Sign approved entries" in the console, then the old one leaves the list.
//
// The mode (CIVIC_CATALOG_SIGNATURES):
//   transition (the default while the shipped rows are signed): a signed row
//     must verify; an unsigned approved row still mounts on its hash; a
//     deployment without a key mounts on hashes alone.
//   required: a row without a valid signature is unapproved, and a deployment
//     without a key mounts nothing.

import type { KeyObject } from "node:crypto";
import { env, isProductionEnv } from "../config/env.js";
import {
  TEST_KEY_PUBLIC,
  keyId,
  parsePublicKey,
  parseSigningKey,
  signatureVerifies,
  type Signature,
  type SignedFields,
  type SigningKey,
} from "../shared/catalogSignature.js";

// No signRow here: the hub verifies, it never signs (the console does).
export { TEST_KEY_PUBLIC, parseSigningKey, signatureVerifies, type Signature, type SignedFields, type SigningKey };

export type SignatureMode = "transition" | "required";

/** The keys a deployment verifies with, from its settings. Exported for tests (they pass their own). */
export interface CatalogKeys {
  mode: SignatureMode;
  /** The console's current key, the one approvals should be signed with: its id and public half. Null without one. */
  primary: { id: string; publicKey: string } | null;
  /** Every key a signature may verify against, by id: the primary and the trusted ones. */
  trusted: Map<string, KeyObject>;
  /** Why a key setting could not be used, when it was set and refused. */
  problem?: string;
}

export function catalogKeys(settings: {
  publicKey?: string;
  trusted?: string;
  mode?: string;
  production?: boolean;
} = {
  publicKey: env.CIVIC_CATALOG_PUBLIC_KEY,
  trusted: env.CIVIC_CATALOG_TRUSTED_KEYS,
  mode: env.CIVIC_CATALOG_SIGNATURES,
}): CatalogKeys {
  const production = settings.production ?? isProductionEnv();
  // An unknown mode fails safe: it is read as required.
  const mode: SignatureMode = (settings.mode ?? "transition").trim() === "transition" ? "transition" : "required";
  const trusted = new Map<string, KeyObject>();
  let primary: CatalogKeys["primary"] = null;
  let problem: string | undefined;
  const refusesTestKey = (der: string) => production && der === TEST_KEY_PUBLIC;
  if (settings.publicKey?.trim()) {
    const der = settings.publicKey.trim();
    const pub = parsePublicKey(der);
    if (!pub) problem = "CIVIC_CATALOG_PUBLIC_KEY is not an Ed25519 public key (base64 DER).";
    else if (refusesTestKey(der)) problem = "CIVIC_CATALOG_PUBLIC_KEY is the committed test key, which a deployment refuses.";
    else {
      primary = { id: keyId(pub), publicKey: der };
      trusted.set(primary.id, pub);
    }
  }
  for (const entry of (settings.trusted ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const pub = parsePublicKey(entry);
    if (!pub) {
      problem ??= "CIVIC_CATALOG_TRUSTED_KEYS has an entry that is not a public key (base64 DER).";
      continue;
    }
    if (refusesTestKey(entry)) continue;
    trusted.set(keyId(pub), pub);
  }
  return { mode, primary, trusted, ...(problem ? { problem } : {}) };
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
