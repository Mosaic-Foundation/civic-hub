// announcement: the process type's manifest (src/processes/manifest.ts; ADR-009).
// Plain data: the registry, the wire, the settings page, the feed and the UI
// are built from it. The handler (./handler.ts) runs its actions.

import { defineDescriptor, defineManifest } from "../../src/processes/manifest.js";

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
  pluginSection: {
 order: 70,
 name: "Announcements",
 what: "Posts from officials and admins on the feed.", fields: [] },
  activities: {},
  // What hub:payload carries publicly, per event (Architecture 3, ADR-010).
  // Who a participant's name is disclosed to (Architecture 3, Q6: Adam, 2026-10-21).
  disclosure: "public",
  // What the hub's analytics counts (ADR-016).
  participation: {
    participation: "none",
    creation: ["civic.process.created"],
    closing: [],
    outcome: ["civic.process.result_published"],
  },
  publicPayload: {
    "civic.process.result_published": ["announcement"],
  },
  feed: {
    cards: [{ event: "civic.process.result_published", legacy: [{ field: "announcement", is: "present" }], card: "announcement" }],
  },
  capabilities: {
    activities: { emit: ["civic.process.result_published"], listen: [] },
    state: { read: ["own-process"], write: ["own-process"], tables: [] },
    adapters: ["mail"],
    network: { egress: [] },
    identity: { claims: ["participant-ref"] },
    ui: { surfaces: ["process-page", "create-page", "feed-card", "settings-panel"] },
  },
});

export default ANNOUNCEMENT_MANIFEST;
