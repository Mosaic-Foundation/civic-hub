// What this hub knows that a descriptor is checked against
// (src/processes/descriptorCheck.ts HostFacts), read from the hub's own lists.

import type { HostFacts } from "../../src/processes/descriptorCheck.js";
import { PLUGIN_IDS } from "../../src/models/hubSettings.js";
import { mappedEventTypes } from "../../src/events/activitySerializer.js";
import { HUB_TABLES } from "../../src/db/forHub.js";
import { EXPORT_MANIFEST } from "../../src/db/schemaContract.js";
import {
  deliberationDraftKind,
  projectDraftKind,
  proposalDraftKind,
  voteDraftKind,
} from "../../src/processes/draftKinds.js";

export function hostFacts(): HostFacts {
  return {
    pluginIds: PLUGIN_IDS,
    mappedEventTypes: mappedEventTypes(),
    hubTables: HUB_TABLES,
    exportManifest: EXPORT_MANIFEST.map((e) => e.table),
    draftKinds: [proposalDraftKind, voteDraftKind, projectDraftKind, deliberationDraftKind].map((k) => ({
      processType: k.spec.processType,
      table: k.spec.table,
    })),
  };
}
