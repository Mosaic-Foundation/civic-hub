// What the Fediverse feature keeps, behind one interface: the database
// (through the feature's host, its own tables only) or memory (tests).

import type { FeatureHost } from "../../src/sdk/index.js";
import { encodeKey } from "./kv.js";

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

/** One line of a roundup: an item it lists. */
export interface RoundupItem {
  title: string;
  pill: string;
  url: string;
}

/** A post the hub made. */
export interface Post {
  id: string;
  kind: "item" | "roundup";
  activity_kind: string | null;
  event_id: string | null;
  process_id: string | null;
  /** Where the post links: the item's page, or the roundup's page. */
  url: string;
  /** The post's text as sent, HTML. */
  content: string;
  items: RoundupItem[] | null;
  published_at: string;
}

/** One post on its way to one inbox. */
export interface Delivery {
  post_id: string;
  inbox_url: string;
  attempts: number;
  next_attempt_at: string;
}

/** What a delivery attempt came to. */
export type DeliveryResult =
  | { delivered: true; status: number }
  | { delivered: false; status: number | null; error: string; next_attempt_at: string | null };

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
  /** Whether an account already follows (a repeated Follow is not a new one). */
  isFollower(actorUri: string): Promise<boolean>;
  followerCount(): Promise<number>;
  /** Followers who started following in [from, to). */
  followersSince(from: string, to: string): Promise<number>;
  /** Where to deliver: each follower's shared inbox when it has one, else its own; each once. */
  inboxes(): Promise<string[]>;

  /** A post, newest first, at most `limit`; older than `before` (published_at) when given. */
  posts(limit: number, before?: string | null): Promise<Post[]>;
  post(id: string): Promise<Post | null>;
  postCount(): Promise<number>;
  /** Store a post and queue its deliveries. Null when an item post for that event exists already. */
  addPost(post: Post, inboxes: readonly string[]): Promise<Post | null>;

  /** Deliveries due by `now`, oldest first, at most `limit`. */
  dueDeliveries(now: string, limit: number): Promise<Delivery[]>;
  recordDelivery(d: Delivery, result: DeliveryResult, now: string): Promise<void>;

  /** A small value the job keeps between runs (its cursor, its last roundup). */
  getState(name: string): Promise<string | null>;
  setState(name: string, value: string): Promise<void>;
}

const KEY_COLUMNS = "rsa_public, rsa_private_sealed, ed25519_public, ed25519_private_sealed";
const POST_COLUMNS = "id, kind, activity_kind, event_id, process_id, url, content, items, published_at";
const stateKey = (name: string) => encodeKey(["civic", "state", name]);

function uniqueInboxes(rows: readonly { inbox_url: string; shared_inbox_url: string | null }[]): string[] {
  return [...new Set(rows.map((r) => r.shared_inbox_url ?? r.inbox_url))];
}

export function dbStore(host: FeatureHost): FediverseStore {
  const t = (name: "fediverse_keys" | "fediverse_followers" | "fediverse_posts" | "fediverse_deliveries" | "fediverse_kv") =>
    host.db().from(name);
  return {
    async keys() {
      return t("fediverse_keys").select<StoredKeys>(KEY_COLUMNS).maybeSingle();
    },
    async saveKeys(keys) {
      // ignoreDuplicates: a second request racing the first keeps the first's keys.
      await t("fediverse_keys").upsert({ ...keys }, { onConflict: "hub_id", ignoreDuplicates: true });
      return t("fediverse_keys").select<StoredKeys>(KEY_COLUMNS).single();
    },
    async addFollower(f) {
      // A repeated Follow refreshes where to deliver; it keeps the first followed_at.
      const known = await t("fediverse_followers").count().eq("actor_uri", f.actor_uri);
      if (known > 0) {
        await t("fediverse_followers").update({ ...f }).eq("actor_uri", f.actor_uri);
      } else {
        await t("fediverse_followers").upsert({ ...f, followed_at: new Date().toISOString() }, { onConflict: "hub_id,actor_uri" });
      }
    },
    async removeFollower(actorUri, followId) {
      let q = t("fediverse_followers").delete().eq("actor_uri", actorUri);
      if (followId) q = q.eq("follow_id", followId);
      const gone = await q.select<{ actor_uri: string }>("actor_uri");
      return gone.length > 0;
    },
    async isFollower(actorUri) {
      return (await t("fediverse_followers").count().eq("actor_uri", actorUri)) > 0;
    },
    async followerCount() {
      return t("fediverse_followers").count();
    },
    async followersSince(from, to) {
      return t("fediverse_followers").count().gte("followed_at", from).lt("followed_at", to);
    },
    async inboxes() {
      const rows = await t("fediverse_followers")
        .select<{ inbox_url: string; shared_inbox_url: string | null }>("inbox_url, shared_inbox_url")
        .order("actor_uri", { ascending: true })
        .limit(50_000);
      return uniqueInboxes(rows);
    },

    async posts(limit, before) {
      let q = t("fediverse_posts").select<Post>(POST_COLUMNS);
      if (before) q = q.lt("published_at", before);
      return q.order("published_at", { ascending: false }).limit(limit);
    },
    async post(id) {
      return t("fediverse_posts").select<Post>(POST_COLUMNS).eq("id", id).maybeSingle();
    },
    async postCount() {
      return t("fediverse_posts").count();
    },
    async addPost(post, inboxes) {
      if (post.event_id && (await t("fediverse_posts").count().eq("event_id", post.event_id)) > 0) return null;
      const [saved] = await t("fediverse_posts").insert({ ...post }).select<Post>(POST_COLUMNS);
      for (let i = 0; i < inboxes.length; i += 500) {
        await t("fediverse_deliveries").insert(
          inboxes.slice(i, i + 500).map((inbox_url) => ({ post_id: post.id, inbox_url, next_attempt_at: post.published_at })),
        );
      }
      return saved ?? post;
    },

    async dueDeliveries(now, limit) {
      return t("fediverse_deliveries")
        .select<Delivery>("post_id, inbox_url, attempts, next_attempt_at")
        .is("delivered_at", null)
        .is("gave_up_at", null)
        .lte("next_attempt_at", now)
        .order("next_attempt_at", { ascending: true })
        .limit(limit);
    },
    async recordDelivery(d, result, now) {
      const base = { attempts: d.attempts + 1, last_status: result.status };
      const values = result.delivered
        ? { ...base, delivered_at: now, last_error: null }
        : result.next_attempt_at
          ? { ...base, next_attempt_at: result.next_attempt_at, last_error: result.error.slice(0, 500) }
          : { ...base, gave_up_at: now, last_error: result.error.slice(0, 500) };
      await t("fediverse_deliveries").update(values).eq("post_id", d.post_id).eq("inbox_url", d.inbox_url);
    },

    async getState(name) {
      const row = await t("fediverse_kv").select<{ value: unknown }>("value").eq("key", stateKey(name)).maybeSingle();
      return typeof row?.value === "string" ? row.value : null;
    },
    async setState(name, value) {
      await t("fediverse_kv").upsert({ key: stateKey(name), value, expires_at: null }, { onConflict: "hub_id,key" });
    },
  };
}

/** The same, in memory, for one hub: the unit tests'. */
export function memoryStore(): FediverseStore & {
  followers: Map<string, Follower & { followed_at: string }>;
  allPosts: Post[];
  deliveries: Map<string, Delivery & { delivered_at?: string; gave_up_at?: string; last_status?: number | null }>;
} {
  let stored: StoredKeys | null = null;
  const followers = new Map<string, Follower & { followed_at: string }>();
  const allPosts: Post[] = [];
  const deliveries = new Map<string, Delivery & { delivered_at?: string; gave_up_at?: string; last_status?: number | null }>();
  const state = new Map<string, string>();
  const dkey = (postId: string, inbox: string) => `${postId} ${inbox}`;
  return {
    followers,
    allPosts,
    deliveries,
    async keys() {
      return stored;
    },
    async saveKeys(keys) {
      stored ??= keys;
      return stored;
    },
    async addFollower(f) {
      const was = followers.get(f.actor_uri);
      followers.set(f.actor_uri, { ...f, followed_at: was?.followed_at ?? new Date().toISOString() });
    },
    async removeFollower(actorUri, followId) {
      const f = followers.get(actorUri);
      if (!f || (followId && f.follow_id !== followId)) return false;
      followers.delete(actorUri);
      return true;
    },
    async isFollower(actorUri) {
      return followers.has(actorUri);
    },
    async followerCount() {
      return followers.size;
    },
    async followersSince(from, to) {
      return [...followers.values()].filter((f) => f.followed_at >= from && f.followed_at < to).length;
    },
    async inboxes() {
      return uniqueInboxes([...followers.values()]);
    },
    async posts(limit, before) {
      return [...allPosts]
        .filter((p) => !before || p.published_at < before)
        .sort((a, b) => b.published_at.localeCompare(a.published_at))
        .slice(0, limit);
    },
    async post(id) {
      return allPosts.find((p) => p.id === id) ?? null;
    },
    async postCount() {
      return allPosts.length;
    },
    async addPost(post, inboxes) {
      if (post.event_id && allPosts.some((p) => p.event_id === post.event_id)) return null;
      allPosts.push(post);
      for (const inbox_url of inboxes) {
        deliveries.set(dkey(post.id, inbox_url), { post_id: post.id, inbox_url, attempts: 0, next_attempt_at: post.published_at });
      }
      return post;
    },
    async dueDeliveries(now, limit) {
      return [...deliveries.values()]
        .filter((d) => !d.delivered_at && !d.gave_up_at && d.next_attempt_at <= now)
        .sort((a, b) => a.next_attempt_at.localeCompare(b.next_attempt_at))
        .slice(0, limit)
        .map(({ post_id, inbox_url, attempts, next_attempt_at }) => ({ post_id, inbox_url, attempts, next_attempt_at }));
    },
    async recordDelivery(d, result, now) {
      const row = deliveries.get(dkey(d.post_id, d.inbox_url));
      if (!row) return;
      row.attempts = d.attempts + 1;
      row.last_status = result.status;
      if (result.delivered) row.delivered_at = now;
      else if (result.next_attempt_at) row.next_attempt_at = result.next_attempt_at;
      else row.gave_up_at = now;
    },
    async getState(name) {
      return state.get(name) ?? null;
    },
    async setState(name, value) {
      state.set(name, value);
    },
  };
}
