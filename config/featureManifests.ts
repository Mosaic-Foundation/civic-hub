// The host's feature packages, as their plain-data manifests (ADR-016;
// src/plugins/feature.ts). Read by src/shared/featureManifests.ts, so the
// tables a hub owns and exports, and the jobs it runs, include them. The
// features themselves (their code) are config/features.ts.

import { ANALYTICS_MANIFEST } from "../features/analytics/manifest.js";

export const FEATURE_PACKAGE_MANIFESTS = [ANALYTICS_MANIFEST] as const;
