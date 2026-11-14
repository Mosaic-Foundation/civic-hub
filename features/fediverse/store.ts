// What the Fediverse feature keeps, behind one interface: the database
// (through the feature's host, its own two tables only) or memory (tests).

import type { FeatureHost } from "../../src/sdk/index.js";

/** The hub's keys as stored: public halves as JWK, private halves sealed. */
export interface StoredKeys {
  rsa_public: JsonWebKey;
  rsa_private_sealed: string;
  ed25519_public: JsonWebKey;
  ed25519_private_sealed: string;
}

/** An account following the hub. */
export interface Follower {
  actor_uri: string;
  inbox_url: string;
  shared_inbox_url: string | null;
  handle: string | null;
  follow_id: string;
}

export interface FediverseStore {
  /** The hub in scope's keys, or null before its account was first asked for. */
  keys(): Promise<StoredKeys | null>;
  /**
   * Store the hub's first keys. When another request stored some first, those
   * win and are returned, so every request signs with the same key.
   */
  saveKeys(keys: StoredKeys): Promise<StoredKeys>;
  /** Add or refresh a follower (a repeated Follow refreshes its inbox and Follow id). */
  addFollower(f: Follower): Promise<void>;
  /** Remove a follower. With `followId`, only when that is the Follow on record. */
  removeFollower(actorUri: string, followId?: string): Promise<boolean>;
  followerCount(): Promise<number>;
}

const KEY_COLUMNS = "rsa_public, rsa_private_sealed, ed25519_public, ed25519_private_sealed";

export function dbStore(host: FeatureHost): FediverseStore {
  return {
    async keys() {
      return host.db().from("fediverse_keys").select<StoredKeys>(KEY_COLUMNS).maybeSingle();
    },
    async saveKeys(keys) {
      // ignoreDuplicates: a second request racing the first keeps the first's keys.
      await host.db().from("fediverse_keys").upsert({ ...keys }, { onConflict: "hub_id", ignoreDuplicates: true });
      const stored = await host.db().from("fediverse_keys").select<StoredKeys>(KEY_COLUMNS).single();
      return stored;
    },
    async addFollower(f) {
      await host
        .db()
        .from("fediverse_followers")
        .upsert({ ...f, followed_at: new Date().toISOString() }, { onConflict: "hub_id,actor_uri" });
    },
    async removeFollower(actorUri, followId) {
      let q = host.db().from("fediverse_followers").delete().eq("actor_uri", actorUri);
      if (followId) q = q.eq("follow_id", followId);
      const gone = await q.select<{ actor_uri: string }>("actor_uri");
      return gone.length > 0;
    },
    async followerCount() {
      return host.db().from("fediverse_followers").count();
    },
  };
}

/** The same, in memory, for one hub: the unit tests'. */
export function memoryStore(): FediverseStore & { followers: Map<string, Follower> } {
  let stored: StoredKeys | null = null;
  const followers = new Map<string, Follower>();
  return {
    followers,
    async keys() {
      return stored;
    },
    async saveKeys(keys) {
      stored ??= keys;
      return stored;
    },
    async addFollower(f) {
      followers.set(f.actor_uri, f);
    },
    async removeFollower(actorUri, followId) {
      const f = followers.get(actorUri);
      if (!f || (followId && f.follow_id !== followId)) return false;
      followers.delete(actorUri);
      return true;
    },
    async followerCount() {
      return followers.size;
    },
  };
}
