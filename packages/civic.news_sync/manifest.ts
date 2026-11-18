// news: the process type's manifest (src/processes/manifest.ts; ADR-009).
// Plain data: the registry, the wire, the settings page, the feed and the UI
// are built from it. The handler (./handler.ts) runs its actions.
//
// News Sync is its own plugin (Adam, 2026-11-18): its posts are News items,
// not announcements, so it works with Announcements switched off and
// Announcements works with it off. The sync job itself is still the hub's
// (src/jobs/newsSync.ts, job "news_sync", under this plugin's switch); it
// moves into this folder with the kernel extraction.

import { defineDescriptor, defineManifest } from "@civic-social/plugin-sdk/manifest";
import { NEWS_CONNECTOR_OPTIONS } from "../../src/shared/connectorOptions.js";

/**
 * What a News item is (src/processes/descriptor.ts). The news sync job
 * creates it, emits result_published and sets it to finalized in one run.
 * Nobody posts or edits one by hand. It has no process actions.
 *
 * Lifecycle: born active and finalized in the same run.
 */
const descriptor = defineDescriptor({
  type: "civic.news",
  version: "0.1",
  tier: 1,
  plugin: "news_sync",
  states: ["active", "finalized"],
  initial_status: "active",
  actions: [],
  emits: ["civic.process.result_published"],
  creation: { resident: null, admin: false, system: true },
  deadline: null,
  brief: false,
  tables: [],
  outside_services: [],
  examples: {},
  display: { label: "News", plural: "News", icon: "announcement" },
});

export const NEWS_MANIFEST = defineManifest({
  descriptor,
  color: "news",
  detailPath: (id) => `/news/${id}`,
  requiredSchema: [],
  tables: [],
  jobs: [],
  pluginSection: {
    order: 90,
    name: "News sync",
    what: "Posts copied in from another site's news feed, each shown on the feed with where it came from.",
    fields: [
      { key: "plugin.news_sync.connector", kind: "choice", options: NEWS_CONNECTOR_OPTIONS },
      { key: "plugin.news_sync.source_url", kind: "url" },
      { key: "plugin.news_sync.from_label", kind: "text", maxLength: 80 },
      { key: "plugin.news_sync.pill_label", kind: "text", maxLength: 40 },
    ],
  },
  activities: {},
  // Who a participant's name is disclosed to: nobody takes part, and the
  // actor is the job.
  disclosure: "public",
  // What the hub's analytics counts (ADR-016): nothing anyone did here.
  participation: {
    participation: "none",
    creation: ["civic.process.created"],
    closing: [],
    outcome: ["civic.process.result_published"],
  },
  publicPayload: {
    "civic.process.result_published": ["news"],
  },
  feed: {
    cards: [{ event: "civic.process.result_published", legacy: [{ field: "news", is: "present" }], card: "news" }],
  },
  capabilities: {
    activities: { emit: ["civic.process.result_published"], listen: [] },
    state: { read: ["own-process"], write: ["own-process"], tables: [] },
    adapters: [],
    network: { egress: [] },
    identity: { claims: ["participant-ref"] },
    ui: { surfaces: ["process-page", "feed-card", "settings-panel"] },
  },
});

export default NEWS_MANIFEST;
