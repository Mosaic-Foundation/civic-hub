// Hub features: switchable parts of a hub that are not process types
// (Architecture 2, 2026-10-21; ADR-009). Each has a `plugin.<id>.enabled`
// switch and a place in the Plugins settings section, exactly like a process
// plugin, and the same settings keys as before the split. Process plugins
// come from the process manifests (src/shared/processManifests.ts); a feature
// package's entry from its manifest's pluginSection (src/shared/
// featureManifests.ts; kernel step 4). The kernel's own features, the ones
// built into it, are listed here.
// Shared with the UI: imports nothing from the server.

import type { SettingFieldSpec } from "./hubSettingsSections.js";
import { FEATURE_MANIFESTS } from "./featureManifests.js";
import { spacePluginRule } from "./spaceTypes.js";

export interface HubFeature {
  id: string;
  /** Its place in the Plugins section, on the process plugins' scale. */
  order: number;
  /** What the Plugins page and the console call it. */
  name: string;
  /** One line on the Plugins page saying what it is. */
  what: string;
  /** Its settings beyond `plugin.<id>.enabled`. */
  fields: readonly SettingFieldSpec[];
  /** Other words an admin might type in the settings search for its panel. */
  words?: readonly string[];
  /**
   * False for a feature a hub must switch on itself (the Fediverse account,
   * 2026-11-13: it speaks to other servers in the hub's name). Every other
   * plugin and feature is on until a hub switches it off.
   */
  defaultOn?: boolean;
}

/** The kernel's own features: built into it, for every space type. */
const KERNEL_FEATURES = [
  {
    id: "search",
    order: 110,
    name: "Search",
    what: "Full-text search across everything on the hub.",
    fields: [],
    words: ["search", "find", "full text"],
  },
  // The address the Feedback page shows (2026-10-08, Adam).
  {
    id: "feedback",
    order: 120,
    name: "Feedback",
    what: "A form for residents to report problems or suggest changes.",
    fields: [{ key: "plugin.feedback.contact_email", kind: "email" }],
    words: ["feedback", "contact", "bug reports", "report a problem", "suggestions"],
  },
  {
    id: "admin_digest",
    order: 140,
    name: "Admin digest",
    what: "A daily email to admins counting what is new since the last one, with what is waiting beside it. Not sent when nothing is new.",
    fields: [],
    words: ["admin email", "daily email", "admin summary", "notifications"],
  },
  // The member count, avatar stack and Members page (Adam, 2026-10-14).
  // Share this hub's invites are the hub's own, not this feature's.
  {
    id: "members",
    order: 150,
    name: "Members",
    what: "The member count and faces on the home page, and the Members page. Share this hub stays either way.",
    fields: [
      { key: "plugin.members.min_count", kind: "number", min: 0, max: 100000 },
      { key: "plugin.members.page_before_threshold", kind: "boolean" },
    ],
    words: ["members", "member count", "faces", "avatars", "directory", "residents list"],
  },
] as const satisfies readonly HubFeature[];

/** Every hub feature, the kernel's and each feature package's, in Plugins-section order. */
export const HUB_FEATURES: readonly (HubFeature & { id: HubFeatureId })[] = [
  ...KERNEL_FEATURES,
  ...FEATURE_MANIFESTS.flatMap((m) => (m.pluginSection ? [{ id: m.feature as HubFeatureId, ...m.pluginSection }] : [])),
].sort((a, b) => a.order - b.order);

export type HubFeatureId =
  | (typeof KERNEL_FEATURES)[number]["id"]
  | Extract<(typeof FEATURE_MANIFESTS)[number], { pluginSection: object }>["feature"];

export const HUB_FEATURE_IDS: readonly HubFeatureId[] = HUB_FEATURES.map((f) => f.id);

/**
 * Whether a plugin or feature is on for a hub that never set its switch: the
 * space type's word (required, on or off by default; kernel rule 6), else the
 * plugin's own default.
 */
export function pluginDefaultOn(id: string): boolean {
  const rule = spacePluginRule(id);
  if (rule) return rule !== "off";
  const feature = HUB_FEATURES.find((f) => f.id === id);
  return feature?.defaultOn ?? true;
}
