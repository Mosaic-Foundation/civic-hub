import { MANIFEST_LIST } from "../../../src/shared/processManifests";
import { HUB_FEATURES } from "../../../src/shared/hubFeatures";

/**
 * What the console calls each plugin (the registry ids are PLUGIN_IDS): a
 * process plugin's name from its manifest's pluginSection, a hub feature's
 * from src/shared/hubFeatures.ts.
 */
export const PLUGIN_NAMES: Record<string, string> = Object.fromEntries([
  ...MANIFEST_LIST.flatMap((m) => (m.pluginSection ? [[m.descriptor.plugin, m.pluginSection.name] as const] : [])),
  ...HUB_FEATURES.map((f) => [f.id, f.name] as const),
]);
