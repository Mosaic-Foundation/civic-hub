// The host's feature packages, as their plain-data manifests (ADR-016;
// src/plugins/feature.ts). Read by src/shared/featureManifests.ts, so the
// tables a hub owns and exports, and the jobs it runs, include them. The
// features themselves (their code) are config/features.ts.

import { ANALYTICS_MANIFEST } from "../features/analytics/manifest.js";
import { FEDIVERSE_MANIFEST } from "../features/fediverse/manifest.js";
import { DIGEST_MANIFEST } from "../features/digest/manifest.js";
import { ASSISTANT_MANIFEST } from "../features/assistant/manifest.js";
import { PINNING_MANIFEST } from "../features/pinning/manifest.js";

export const FEATURE_PACKAGE_MANIFESTS = [ANALYTICS_MANIFEST, FEDIVERSE_MANIFEST, DIGEST_MANIFEST, ASSISTANT_MANIFEST, PINNING_MANIFEST] as const;
