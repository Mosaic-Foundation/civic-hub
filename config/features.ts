// The host's feature packages (ADR-016; src/plugins/feature.ts): hub features
// built as plugin packages are, loaded by src/plugins/features.ts. Their
// manifests are listed again, as plain data, in config/featureManifests.ts.

import type { FeaturePackage } from "../src/plugins/feature.js";
import analytics from "../features/analytics/index.js";

export const FEATURE_PACKAGES: readonly FeaturePackage[] = [analytics];
