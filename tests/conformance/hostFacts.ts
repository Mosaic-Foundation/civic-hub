// What this hub knows that a descriptor is checked against
// (src/processes/descriptorCheck.ts HostFacts), read from the hub's own lists.

import type { HostFacts } from "../../src/processes/descriptorCheck.js";
import { PROCESS_PLUGIN_IDS } from "../../src/models/hubSettings.js";
import { mappedEventTypes } from "../../src/events/activitySerializer.js";
import { HUB_TABLES } from "../../src/db/forHub.js";
import { EXPORT_MANIFEST } from "../../src/db/schemaContract.js";
import { loadedPackages } from "../../src/plugins/loader.js";
import { deliberationDraftKind } from "../../src/processes/draftKinds.js";

export function hostFacts(): HostFacts {
  return {
    pluginIds: PROCESS_PLUGIN_IDS,
    mappedEventTypes: mappedEventTypes(),
    hubTables: HUB_TABLES,
    exportManifest: EXPORT_MANIFEST.map((e) => e.table),
    // A package's draft kind is its own (ADR-014); the types not yet in
    // packages keep theirs in src/processes/draftKinds.ts.
    draftKinds: [
      ...loadedPackages().flatMap((p) => (p.server.drafts ? [p.server.drafts.kind] : [])),
      deliberationDraftKind,
    ].map((k) => ({
      processType: k.spec.processType,
      table: k.spec.table,
    })),
  };
}
