// The resident digest: a summary email of new activity to each resident who
// has not unsubscribed, in the hub's own send hour (kernel step 3; it was
// src/modules/civic.digest and src/jobs/digest.ts). A hub feature built as a
// plugin package is (src/plugins/feature.ts): one folder, the SDK and
// src/shared/ only, its switch plugin.digest.enabled. Its unsubscribe links,
// and the page that takes them, are the kernel's.

import type { FeaturePackage } from "../../src/sdk/index.js";
import { DIGEST_MANIFEST } from "./manifest.js";
import { digestJob } from "./job.js";

const digest: FeaturePackage = {
  name: "@civic-social/feature-digest",
  version: "0.1.0",
  displayName: "Email digest",
  manifest: DIGEST_MANIFEST,
  server() {
    return { jobs: { digest: digestJob } };
  },
};

export default digest;
