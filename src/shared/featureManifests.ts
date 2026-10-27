// Every feature package this hub software carries, as its manifest (ADR-016;
// src/processes/manifest.ts's FeatureManifest): their tables join the hub's
// (src/db/forHub.ts, the export manifest), their jobs the registry's. The
// list is config/featureManifests.ts.

import { FEATURE_PACKAGE_MANIFESTS } from "../../config/featureManifests.js";
import type { FeatureManifest } from "../processes/manifest.js";

export const FEATURE_MANIFESTS = FEATURE_PACKAGE_MANIFESTS;
export const FEATURE_MANIFEST_LIST: readonly FeatureManifest[] = FEATURE_MANIFESTS;

/** Every table a feature owns, by name. */
export type FeatureTableName = (typeof FEATURE_MANIFESTS)[number]["tables"][number]["name"];
