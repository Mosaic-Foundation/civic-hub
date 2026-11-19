// The Fediverse feature's manifest (src/processes/manifest.ts's
// FeatureManifest). Plain data: the host reads its tables without loading its
// code.

import { defineFeatureManifest } from "../../src/processes/manifest.js";

export const FEDIVERSE_MANIFEST = defineFeatureManifest({
  feature: "fediverse",
  tables: [
    {
      name: "fediverse_keys",
      rows: "omit",
      reason: "secret: sealed with this deployment's secret, so useless elsewhere; the next host makes the hub new keys",
      key: ["hub_id"],
      holds: "the hub's signing keys for the fediverse, the private halves sealed",
    },
    {
      name: "fediverse_followers",
      rows: "export",
      key: ["hub_id", "actor_uri"],
      holds: "the fediverse accounts following the hub, and where to deliver to them",
    },
    {
      name: "fediverse_kv",
      rows: "omit",
      reason: "a cache and duplicate-message marks for this deployment; the next host starts empty",
      key: ["hub_id", "key"],
      holds: "the fediverse library's working memory: messages already seen, other servers' documents",
    },
    {
      name: "fediverse_posts",
      rows: "export",
      key: ["hub_id", "id"],
      holds: "what the hub posted to the fediverse",
    },
    {
      name: "fediverse_deliveries",
      rows: "omit",
      reason: "the delivery log of posts already sent; the next host does not resend them",
      key: ["hub_id", "post_id", "inbox_url"],
      holds: "each post's delivery to each follower's server, and its retries",
    },
    {
      name: "fediverse_replies",
      rows: "export",
      key: ["hub_id", "id"],
      holds: "replies from the fediverse to the hub's posts, as text with links to any media",
    },
    {
      name: "fediverse_reactions",
      rows: "export",
      key: ["hub_id", "activity_id"],
      holds: "likes and boosts of the hub's posts, one per account and post",
    },
  ],
  requiredSchema: [
    {
      table: "fediverse_keys",
      columns: ["hub_id", "rsa_public", "rsa_private_sealed", "ed25519_public", "ed25519_private_sealed", "created_at"],
      owner: "features/fediverse",
    },
    {
      table: "fediverse_followers",
      columns: ["hub_id", "actor_uri", "inbox_url", "shared_inbox_url", "handle", "follow_id", "followed_at"],
      owner: "features/fediverse",
    },
    { table: "fediverse_kv", columns: ["hub_id", "key", "value", "expires_at"], owner: "features/fediverse" },
    {
      table: "fediverse_posts",
      columns: ["hub_id", "id", "kind", "activity_kind", "event_id", "process_id", "url", "content", "items", "published_at", "process_iri", "activity_iri", "image_url", "image_alt"],
      owner: "features/fediverse",
    },
    {
      table: "fediverse_deliveries",
      columns: ["hub_id", "post_id", "inbox_url", "attempts", "next_attempt_at", "delivered_at", "gave_up_at", "last_status", "last_error"],
      owner: "features/fediverse",
    },
    {
      table: "fediverse_replies",
      columns: ["hub_id", "id", "post_id", "actor_uri", "actor_handle", "text", "media_links", "url", "published_at", "received_at", "edited_at"],
      owner: "features/fediverse",
    },
    {
      table: "fediverse_reactions",
      columns: ["hub_id", "activity_id", "kind", "post_id", "actor_uri", "received_at"],
      owner: "features/fediverse",
    },
  ],
  jobs: [
    {
      id: "fediverse",
      plugin: "fediverse",
      path: "/fediverse/run",
      // Every ten minutes: a new item reaches followers within ten minutes,
      // and a server that was down gets its retry soon after it is back.
      schedule: "*/10 * * * *",
      description: "Fediverse: post what opened and what was decided, deliver posts to followers' servers, retry failures",
    },
  ],
  // Off until the hub switches it on: once on, other servers hold the hub's
  // account and its followers.
  pluginSection: {
    order: 170,
    name: "Fediverse",
    what: "An account people can follow from Mastodon and other fediverse apps, and a Share on Mastodon button on each page.",
    fields: [
      { key: "plugin.fediverse.post_mode", kind: "choice", options: ["each", "daily", "weekly"] },
      { key: "plugin.fediverse.hashtags", kind: "text", maxLength: 200 },
      { key: "plugin.fediverse.blocked_servers", kind: "textarea", maxLength: 5000 },
    ],
    defaultOn: false,
    words: ["fediverse", "mastodon", "activitypub", "follow", "followers", "social media", "bluesky"],
  },
});
