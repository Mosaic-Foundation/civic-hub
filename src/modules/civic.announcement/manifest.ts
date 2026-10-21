// announcement: the process type's manifest (src/processes/manifest.ts; ADR-009).
// Plain data: the registry, the wire, the settings page, the feed and the UI
// are built from it. The handler (./handler.ts) runs its actions.

import { defineDescriptor, defineManifest } from "../../processes/manifest.js";

/**
 * What an announcement is (src/processes/descriptor.ts). It is published the
 * moment it is made: the announcement routes (admins and officials) and the
 * news sync job create the row, emit result_published, and set it to
 * finalized. Edits, removal and restore are those routes and emit only
 * civic.process.updated. It has no process actions.
 *
 * Lifecycle: born active and finalized in the same request (the row is never
 * observably active).
 */
const descriptor = defineDescriptor({
  type: "civic.announcement",
  version: "0.1",
  tier: 1,
  plugin: "announcement",
  states: ["active", "finalized"],
  initial_status: "active",
  actions: [],
  emits: ["civic.process.result_published"],
  creation: { resident: null, admin: true, system: true },
  deadline: null,
  brief: false,
  tables: [],
  outside_services: [],
  examples: {
    create: { path: "/announcement", body: { title: "Conformance announcement", body: "A notice." } },
  },
  display: { label: "Announcement", plural: "Announcements", icon: "announcement" },
});

export const ANNOUNCEMENT_MANIFEST = defineManifest({
  descriptor,
  color: "announcement",
  detailPath: (id) => `/announcement/${id}`,
  requiredSchema: [],
  tables: [],
  jobs: [],
  pluginSection: { order: 70, fields: [] },
  activities: {},
  publicListing: "always",
});
