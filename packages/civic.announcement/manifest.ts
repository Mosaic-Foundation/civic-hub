// announcement: the process type's manifest (src/processes/manifest.ts; ADR-009).
// Plain data: the registry, the wire, the settings page, the feed and the UI
// are built from it. The handler (./handler.ts) runs its actions.

import { defineDescriptor, defineManifest } from "@civic-social/plugin-sdk/manifest";
import { announcementCard } from "./feed.js";

/**
 * What an announcement is (src/processes/descriptor.ts). It is published the
 * moment it is made: the announcement routes (admins and officials) create
 * the row, emit result_published, and set it to finalized. Edits, removal and restore are those routes and emit only
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
  // Its colours' defaults (kernel step 4: each plugin carries its own). The
  // Civic Hub's palette lists the same keys (a few following its base colours), and wins.
  colors: [
    { key: "announcement", label: "Announcements", fg: "#6e3013", bg: "#f4e3db", dark: { fg: "#e6a283", bg: "#33241d" }, email: { fg: "#8c3210", bg: "#fbe5d3" } },
    { key: "announcement-author", label: "Officials' announcements", fg: "#3a2c5e", bg: "#e4ddf0", dark: { fg: "#c3b4e6", bg: "#2a2538" } },
  ],
  detailPath: (id) => `/announcement/${id}`,
  requiredSchema: [],
  tables: [],
  jobs: [],
  pluginSection: {
 order: 70,
 name: "Announcements",
 what: "Posts from officials and admins on the feed.", fields: [],
    words: ["announcements", "news", "notices", "posts", "updates"],
    help: { text: "Posts from admins and officials on the feed. People can read them but not reply. Who may post is set under Officials.", page: "/reference/plugins", anchor: "plugins-announcement" },
  },
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
    cards: [{ event: "civic.process.result_published", legacy: [{ field: "announcement", is: "present" }], card: { surface: "announcement", color: "announcement", fromPayload: announcementCard } }],
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
