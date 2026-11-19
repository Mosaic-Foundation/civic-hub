// Hub features: switchable parts of a hub that are not process types
// (Architecture 2, 2026-10-21; ADR-009). Each has a `plugin.<id>.enabled`
// switch and a place in the Plugins settings section, exactly like a process
// plugin, and the same settings keys as before the split. Process plugins
// come from the process manifests (src/shared/processManifests.ts); a feature
// package's entry from its manifest's pluginSection (src/shared/
// featureManifests.ts; kernel step 4).
// Shared with the UI: imports nothing from the server.

import type { SettingFieldSpec } from "./hubSettingsSections.js";
import { FEATURE_MANIFESTS } from "./featureManifests.js";
import { spacePluginRule } from "./spaceTypes.js";

export interface HubFeature {
  id: string;
  /** Its place in the Plugins section, on the process plugins' scale. */
  order: number;
  /** What the Plugins page and the console call it. */
  name: string;
  /** One line on the Plugins page saying what it is. */
  what: string;
  /** Its settings beyond `plugin.<id>.enabled`. */
  fields: readonly SettingFieldSpec[];
  /** Other words an admin might type in the settings search for its panel. */
  words?: readonly string[];
  /**
   * False for a feature a hub must switch on itself (the Fediverse account,
   * 2026-11-13: it speaks to other servers in the hub's name). Every other
   * plugin and feature is on until a hub switches it off.
   */
  defaultOn?: boolean;
}

// The kernel has no features of its own (kernel step 4, 2026-11-19: Members,
// its last, became a plugin). Every hub feature is a feature package's.

/** Every hub feature, each feature package's, in Plugins-section order. */
export const HUB_FEATURES: readonly (HubFeature & { id: HubFeatureId })[] = FEATURE_MANIFESTS.flatMap((m) =>
  m.pluginSection ? [{ id: m.feature as HubFeatureId, ...m.pluginSection }] : [],
).sort((a, b) => a.order - b.order);

export type HubFeatureId = Extract<(typeof FEATURE_MANIFESTS)[number], { pluginSection: object }>["feature"];
export const HUB_FEATURE_IDS: readonly HubFeatureId[] = HUB_FEATURES.map((f) => f.id);

/**
 * Whether a plugin or feature is on for a hub that never set its switch: the
 * space type's word (required, on or off by default; kernel rule 6), else the
 * plugin's own default.
 */
export function pluginDefaultOn(id: string): boolean {
  const rule = spacePluginRule(id);
  if (rule) return rule !== "off";
  const feature = HUB_FEATURES.find((f) => f.id === id);
  return feature?.defaultOn ?? true;
}
