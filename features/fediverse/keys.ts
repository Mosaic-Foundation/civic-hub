// The hub's signing keys: an RSA key for HTTP Signatures (what Mastodon
// checks on every delivery) and an Ed25519 key for object integrity proofs.
// Made the first time the hub's account is asked for, then kept: changing
// them makes every follower's server fetch the account again. The private
// halves are stored sealed (src/services/sealedSecrets.ts, through the SDK)
// with the hub's id, never in the clear.

import { exportJwk, generateCryptoKeyPair, importJwk } from "@fedify/fedify";
import { openSealed, seal } from "../../src/sdk/index.js";
import type { FediverseStore, StoredKeys } from "./store.js";

const PURPOSE = "fediverse-signing-key";

async function sealPair(hubId: string, pair: CryptoKeyPair): Promise<{ pub: JsonWebKey; sealed: string }> {
  const pub = await exportJwk(pair.publicKey);
  const priv = await exportJwk(pair.privateKey);
  return { pub, sealed: seal(PURPOSE, hubId, JSON.stringify(priv)) };
}

async function openPair(hubId: string, pub: JsonWebKey, sealed: string): Promise<CryptoKeyPair> {
  return {
    publicKey: await importJwk(pub, "public"),
    privateKey: await importJwk(JSON.parse(openSealed(PURPOSE, hubId, sealed)) as JsonWebKey, "private"),
  };
}

/** The hub's two key pairs, RSA first, made and stored on first use. */
export async function hubKeyPairs(store: FediverseStore, hubId: string): Promise<CryptoKeyPair[]> {
  let stored = await store.keys();
  if (!stored) {
    const rsa = await sealPair(hubId, await generateCryptoKeyPair("RSASSA-PKCS1-v1_5"));
    const ed = await sealPair(hubId, await generateCryptoKeyPair("Ed25519"));
    const fresh: StoredKeys = {
      rsa_public: rsa.pub,
      rsa_private_sealed: rsa.sealed,
      ed25519_public: ed.pub,
      ed25519_private_sealed: ed.sealed,
    };
    stored = await store.saveKeys(fresh);
  }
  return [
    await openPair(hubId, stored.rsa_public, stored.rsa_private_sealed),
    await openPair(hubId, stored.ed25519_public, stored.ed25519_private_sealed),
  ];
}
