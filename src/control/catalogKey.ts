// The console's catalog key (ADR-015; the console split, step 2): the
// Ed25519 private key it signs plugin approvals with. Only the console holds
// it. A hub deployment verifies with the public half alone
// (CIVIC_CATALOG_PUBLIC_KEY, or this setting's public half while the console
// shares the hub's deployment), so stealing a hub's settings or its database
// cannot approve a plugin.

import { env, isProductionEnv } from "../config/env.js";
import { parseSigningKey, signRow, type Signature, type SignedFields, type SigningKey } from "../shared/catalogSignature.js";

export interface ConsoleKey {
  key: SigningKey | null;
  /** Why CIVIC_CATALOG_SIGNING_KEY could not be used, when it was set. */
  problem: string | null;
}

let cached: ConsoleKey | null = null;

export function consoleKey(): ConsoleKey {
  if (cached) return cached;
  const raw = env.CIVIC_CATALOG_SIGNING_KEY?.trim();
  if (!raw) return (cached = { key: null, problem: null });
  try {
    return (cached = { key: parseSigningKey(raw, isProductionEnv()), problem: null });
  } catch (err) {
    return (cached = { key: null, problem: err instanceof Error ? err.message : String(err) });
  }
}

/** Forget the key read (tests that change the setting). */
export function resetConsoleKey(): void {
  cached = null;
}

/** The signature for a row, or null when the console has no key. */
export function signEntry(row: SignedFields): Signature | null {
  const { key } = consoleKey();
  return key ? signRow(row, key) : null;
}
