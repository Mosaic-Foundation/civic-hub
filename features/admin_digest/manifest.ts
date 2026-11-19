// The Admin digest plugin's manifest (src/processes/manifest.ts's
// FeatureManifest). Plain data: the host reads its table, its job and its
// Plugins entry without loading its code.

import { defineFeatureManifest } from "../../src/processes/manifest.js";

export const ADMIN_DIGEST_MANIFEST = defineFeatureManifest({
  feature: "admin_digest",
  tables: [
    {
      name: "admin_digest_marks",
      rows: "omit",
      key: ["hub_id"],
      reason: "where this host's last admin digest stopped; the next host starts its own",
      holds: "where the last admin digest that went out covered up to",
    },
  ],
  requiredSchema: [{ table: "admin_digest_marks", columns: ["hub_id", "covered_until", "updated_at"], owner: "features/admin_digest" }],
  jobs: [
    {
      id: "admin_digest",
      plugin: "admin_digest",
      path: "/admin-digest/run",
      schedule: "30 13 * * *",
      description: "Admin review-queue digest, per hub",
    },
  ],
  pluginSection: {
    order: 140,
    name: "Admin digest",
    what: "A daily email to admins counting what is new since the last one, with what is waiting beside it. Not sent when nothing is new.",
    fields: [],
    words: ["admin email", "daily email", "admin summary", "notifications"],
  },
});
