// What each plugin is called (the registry ids are PLUGIN_IDS): a process
// plugin's name from its manifest's pluginSection, a hub feature's from
// src/shared/hubFeatures.ts. The operator API sends these to the console
// (the console split, step 4), which no longer reads the hub's manifests.

import { MANIFEST_LIST } from "./processManifests.js";
import { HUB_FEATURES } from "./hubFeatures.js";

export const PLUGIN_NAMES: Readonly<Record<string, string>> = Object.fromEntries([
  ...MANIFEST_LIST.flatMap((m) => (m.pluginSection ? [[m.descriptor.plugin, m.pluginSection.name] as const] : [])),
  ...HUB_FEATURES.map((f) => [f.id, f.name] as const),
]);
