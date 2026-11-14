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
  ],
  jobs: [],
});
