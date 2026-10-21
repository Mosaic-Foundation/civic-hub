// Hub features: switchable parts of a hub that are not process types
// (Architecture 2, 2026-10-21; ADR-009). Each has a `plugin.<id>.enabled`
// switch and a place in the Plugins settings section, exactly like a process
// plugin, and the same settings keys as before the split. Process plugins
// come from the process manifests (src/shared/processManifests.ts); this is
// the one hand-kept list left, because a feature is part of the hub itself.
// Shared with the UI: imports nothing from the server.

import type { SettingFieldSpec } from "./hubSettingsSections.js";
import { NEWS_CONNECTOR_OPTIONS } from "./connectorOptions.js";

export interface HubFeature {
  id: string;
  /** Its place in the Plugins section, on the process plugins' scale. */
  order: number;
  /** Its settings beyond `plugin.<id>.enabled`. */
  fields: readonly SettingFieldSpec[];
}

export const HUB_FEATURES = [
  {
    id: "news_sync",
    order: 90,
    fields: [
      { key: "plugin.news_sync.connector", kind: "choice", options: NEWS_CONNECTOR_OPTIONS },
      { key: "plugin.news_sync.source_url", kind: "url" },
    ],
  },
  { id: "assistant", order: 100, fields: [] },
  { id: "search", order: 110, fields: [] },
  // The address the Feedback page shows (2026-10-08, Adam).
  { id: "feedback", order: 120, fields: [{ key: "plugin.feedback.contact_email", kind: "email" }] },
  { id: "digest", order: 130, fields: [{ key: "plugin.digest.send_hour", kind: "hour" }] },
  { id: "admin_digest", order: 140, fields: [] },
  // The member count, avatar stack and Members page (Adam, 2026-10-14).
  // Share this hub's invites are the hub's own, not this feature's.
  {
    id: "members",
    order: 150,
    fields: [
      { key: "plugin.members.min_count", kind: "number", min: 0, max: 100000 },
      { key: "plugin.members.page_before_threshold", kind: "boolean" },
    ],
  },
] as const satisfies readonly HubFeature[];

export type HubFeatureId = (typeof HUB_FEATURES)[number]["id"];

export const HUB_FEATURE_IDS: readonly HubFeatureId[] = HUB_FEATURES.map((f) => f.id);
