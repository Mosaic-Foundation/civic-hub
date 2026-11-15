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
  /** The item's process IRI and civic activity id (absent on roundups made before 2026-11-15). */
  process_iri?: string;
  activity_iri?: string;
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
  /** An item post's process IRI (the Note's context) and civic activity id; null on a roundup. */
  process_iri: string | null;
  activity_iri: string | null;
  /** The item's image (absolute) and its description; null on a roundup or an item without one. */
  image_url: string | null;
  image_alt: string | null;
}

/** One post on its way to one inbox. */
export interface Delivery {
  post_id: string;
  inbox_url: string;
  attempts: number;
  next_attempt_at: string;
}

/** A reply from the fediverse to one of the hub's posts, kept as text. */
export interface Reply {
  id: string;
  post_id: string;
  actor_uri: string;
  actor_handle: string | null;
  text: string;
  media_links: string[];
  url: string | null;
  published_at: string | null;
}

/** A like or boost of one of the hub's posts. */
export interface Reaction {
  activity_id: string;
  kind: "like" | "boost";
  post_id: string;
  actor_uri: string;
}

/** What came back from the fediverse in a period. */
export interface Returns {
  replies: number;
  likes: number;
  boosts: number;
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
  /** The hub's newest item post about a process, or null. */
  postForProcess(processId: string): Promise<Post | null>;
  postCount(): Promise<number>;
  /** Store a post and queue its deliveries. Null when an item post for that event exists already. */
  addPost(post: Post, inboxes: readonly string[]): Promise<Post | null>;

  /** Deliveries due by `now`, oldest first, at most `limit`. */
  dueDeliveries(now: string, limit: number): Promise<Delivery[]>;
  recordDelivery(d: Delivery, result: DeliveryResult, now: string): Promise<void>;

  /** Keep a reply, or its edit (same id, same author). False when another account's reply has that id. */
  saveReply(reply: Reply): Promise<boolean>;
  /** Delete a reply, only when `actorUri` wrote it. */
  deleteReply(id: string, actorUri: string): Promise<boolean>;
  /** Keep a like or boost; one per account, post and kind (a repeat is ignored). */
  addReaction(reaction: Reaction): Promise<void>;
  /** Take back a like or boost, only when `actorUri` made it. */
  removeReaction(activityId: string, actorUri: string): Promise<boolean>;
  /** Everything an account sent: when the account itself is deleted. */
  forgetActor(actorUri: string): Promise<void>;
  /** Replies, likes and boosts received in [from, to). */
  returnsSince(from: string, to: string): Promise<Returns>;

  /** A small value the job keeps between runs (its cursor, its last roundup). */
  getState(name: string): Promise<string | null>;
  setState(name: string, value: string): Promise<void>;
}

const KEY_COLUMNS = "rsa_public, rsa_private_sealed, ed25519_public, ed25519_private_sealed";
const POST_COLUMNS = "id, kind, activity_kind, event_id, process_id, url, content, items, published_at, process_iri, activity_iri, image_url, image_alt";
const stateKey = (name: string) => encodeKey(["civic", "state", name]);

function uniqueInboxes(rows: readonly { inbox_url: string; shared_inbox_url: string | null }[]): string[] {
  return [...new Set(rows.map((r) => r.shared_inbox_url ?? r.inbox_url))];
}

export function dbStore(host: FeatureHost): FediverseStore {
  const t = (
    name:
      | "fediverse_keys"
      | "fediverse_followers"
      | "fediverse_posts"
      | "fediverse_deliveries"
      | "fediverse_kv"
      | "fediverse_replies"
      | "fediverse_reactions",
  ) =>
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
    async postForProcess(processId) {
      const [p] = await t("fediverse_posts")
        .select<Post>(POST_COLUMNS)
        .eq("process_id", processId)
        .eq("kind", "item")
        .order("published_at", { ascending: false })
        .limit(1);
      return p ?? null;
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

    async saveReply(reply) {
      const was = await t("fediverse_replies").select<{ actor_uri: string }>("actor_uri").eq("id", reply.id).maybeSingle();
      if (was && was.actor_uri !== reply.actor_uri) return false;
      if (was) {
        await t("fediverse_replies")
          .update({ text: reply.text, media_links: reply.media_links, url: reply.url, edited_at: new Date().toISOString() })
          .eq("id", reply.id);
      } else {
        await t("fediverse_replies").upsert({ ...reply }, { onConflict: "hub_id,id", ignoreDuplicates: true });
      }
      return true;
    },
    async deleteReply(id, actorUri) {
      const gone = await t("fediverse_replies").delete().eq("id", id).eq("actor_uri", actorUri).select<{ id: string }>("id");
      return gone.length > 0;
    },
    async addReaction(r) {
      await t("fediverse_reactions").upsert({ ...r }, { onConflict: "hub_id,post_id,actor_uri,kind", ignoreDuplicates: true });
    },
    async removeReaction(activityId, actorUri) {
      const gone = await t("fediverse_reactions")
        .delete()
        .eq("activity_id", activityId)
        .eq("actor_uri", actorUri)
        .select<{ activity_id: string }>("activity_id");
      return gone.length > 0;
    },
    async forgetActor(actorUri) {
      await t("fediverse_replies").delete().eq("actor_uri", actorUri);
      await t("fediverse_reactions").delete().eq("actor_uri", actorUri);
      await t("fediverse_followers").delete().eq("actor_uri", actorUri);
    },
    async returnsSince(from, to) {
      const [replies, likes, boosts] = await Promise.all([
        t("fediverse_replies").count().gte("received_at", from).lt("received_at", to),
        t("fediverse_reactions").count().eq("kind", "like").gte("received_at", from).lt("received_at", to),
        t("fediverse_reactions").count().eq("kind", "boost").gte("received_at", from).lt("received_at", to),
      ]);
      return { replies, likes, boosts };
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
  replies: Map<string, Reply & { received_at: string; edited_at?: string }>;
  reactions: Map<string, Reaction & { received_at: string }>;
  followers: Map<string, Follower & { followed_at: string }>;
  allPosts: Post[];
  deliveries: Map<string, Delivery & { delivered_at?: string; gave_up_at?: string; last_status?: number | null }>;
} {
  let stored: StoredKeys | null = null;
  const followers = new Map<string, Follower & { followed_at: string }>();
  const allPosts: Post[] = [];
  const deliveries = new Map<string, Delivery & { delivered_at?: string; gave_up_at?: string; last_status?: number | null }>();
  const state = new Map<string, string>();
  const replies = new Map<string, Reply & { received_at: string; edited_at?: string }>();
  const reactions = new Map<string, Reaction & { received_at: string }>();
  const dkey = (postId: string, inbox: string) => `${postId} ${inbox}`;
  return {
    replies,
    reactions,
    followers,
    allPosts,
    deliveries,
    async saveReply(reply) {
      const was = replies.get(reply.id);
      if (was && was.actor_uri !== reply.actor_uri) return false;
      replies.set(reply.id, was ? { ...was, ...reply, edited_at: new Date().toISOString() } : { ...reply, received_at: new Date().toISOString() });
      return true;
    },
    async deleteReply(id, actorUri) {
      const r = replies.get(id);
      if (!r || r.actor_uri !== actorUri) return false;
      return replies.delete(id);
    },
    async addReaction(r) {
      const dup = [...reactions.values()].some((x) => x.post_id === r.post_id && x.actor_uri === r.actor_uri && x.kind === r.kind);
      if (!dup && !reactions.has(r.activity_id)) reactions.set(r.activity_id, { ...r, received_at: new Date().toISOString() });
    },
    async removeReaction(activityId, actorUri) {
      const r = reactions.get(activityId);
      if (!r || r.actor_uri !== actorUri) return false;
      return reactions.delete(activityId);
    },
    async forgetActor(actorUri) {
      for (const [k, v] of replies) if (v.actor_uri === actorUri) replies.delete(k);
      for (const [k, v] of reactions) if (v.actor_uri === actorUri) reactions.delete(k);
      followers.delete(actorUri);
    },
    async returnsSince(from, to) {
      const within = (at: string) => at >= from && at < to;
      const rs = [...reactions.values()].filter((r) => within(r.received_at));
      return {
        replies: [...replies.values()].filter((r) => within(r.received_at)).length,
        likes: rs.filter((r) => r.kind === "like").length,
        boosts: rs.filter((r) => r.kind === "boost").length,
      };
    },
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
    async postForProcess(processId) {
      return (
        [...allPosts]
          .filter((p) => p.kind === "item" && p.process_id === processId)
          .sort((a, b) => b.published_at.localeCompare(a.published_at))[0] ?? null
      );
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
