// What this hub knows that a descriptor is checked against
// (src/processes/descriptorCheck.ts HostFacts), read from the hub's own lists.

import {
  EXPORT_MANIFEST,
  HUB_TABLES,
  PROCESS_PLUGIN_IDS,
  loadedPackages,
  mappedEventTypes,
  type HostFacts,
} from "@civic-social/plugin-sdk/testing";

export function hostFacts(): HostFacts {
  return {
    pluginIds: PROCESS_PLUGIN_IDS,
    mappedEventTypes: mappedEventTypes(),
    hubTables: HUB_TABLES,
    exportManifest: EXPORT_MANIFEST.map((e) => e.table),
    // A package's draft kind is its own (ADR-014).
    draftKinds: [
      ...loadedPackages().flatMap((p) => (p.server.drafts ? [p.server.drafts.kind] : [])),
    ].map((k) => ({
      processType: k.spec.processType,
      table: k.spec.table,
    })),
  };
}
