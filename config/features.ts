// The host's feature packages (ADR-016; src/plugins/feature.ts): hub features
// built as plugin packages are, loaded by src/plugins/features.ts. Their
// manifests are listed again, as plain data, in config/featureManifests.ts.

import type { FeaturePackage } from "../src/plugins/feature.js";
import analytics from "../features/analytics/index.js";
import fediverse from "../features/fediverse/index.js";
import digest from "../features/digest/index.js";
import assistant from "../features/assistant/index.js";
import pinning from "../features/pinning/index.js";
import feedback from "../features/feedback/index.js";
import adminDigest from "../features/admin_digest/index.js";
import searchFeature from "../features/search/index.js";
import members from "../features/members/index.js";

export const FEATURE_PACKAGES: readonly FeaturePackage[] = [analytics, fediverse, digest, assistant, pinning, feedback, adminDigest, searchFeature, members];
