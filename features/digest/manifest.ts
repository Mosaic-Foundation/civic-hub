// The resident digest's manifest (ADR-016; src/processes/manifest.ts's
// FeatureManifest). Plain data: the host reads its jobs without loading its
// code. It owns no table: who asked for it and when each was last mailed are
// on the kernel's users (digest_frequency_days, last_digest_sent_at).

import { defineFeatureManifest } from "../../src/processes/manifest.js";

export const DIGEST_MANIFEST = defineFeatureManifest({
  feature: "digest",
  tables: [],
  requiredSchema: [],
  jobs: [
    {
      id: "digest",
      plugin: "digest",
      path: "/digest/run",
      // Hourly: each hub is mailed in its own plugin.digest.send_hour, read in
      // its identity.timezone (job.ts).
      schedule: "0 * * * *",
      description: "Resident email digest, per hub in its own send hour",
    },
  ],
  pluginSection: {
    order: 130,
    name: "Email digest",
    what: "A summary email of new activity to each resident who has not unsubscribed.",
    fields: [{ key: "plugin.digest.send_hour", kind: "hour" }],
    words: ["digest", "newsletter", "summary email", "weekly email", "daily email"],
  },
});
