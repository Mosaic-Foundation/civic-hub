// The Admin digest: a daily email to a space's admins counting what is new
// since the last one, with what is waiting beside it (a kernel module until
// kernel step 4, 2026-11-19: "if it can be a plugin, it is one"; not every
// space has admins). The counts are the kernel's (SDK `adminWindow`); this
// plugin keeps its mark, renders and sends. A hub feature built as a plugin
// package is (src/plugins/feature.ts): one folder, the SDK and src/shared/
// only, its own table, its switch plugin.admin_digest.enabled.

import type { FeaturePackage } from "../../src/sdk/index.js";
import { ADMIN_DIGEST_MANIFEST } from "./manifest.js";
import { markStore } from "./store.js";
import { adminDigestJob } from "./job.js";

const adminDigest: FeaturePackage = {
  name: "@civic-social/feature-admin-digest",
  version: "0.1.0",
  displayName: "Admin digest",
  manifest: ADMIN_DIGEST_MANIFEST,
  server(host) {
    return { jobs: { admin_digest: adminDigestJob(markStore(host)) } };
  },
};

export default adminDigest;
