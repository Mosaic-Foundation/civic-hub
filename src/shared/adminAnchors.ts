// Every place in the admin panel a link can point at (admin menu slice,
// 2026-10-13). Shared by the UI (routes, ids, the redirects) and the help
// registry's tests, so an anchor named in one place exists in the other.
//
//   /admin#moderation                     → the Moderation tab
//   /admin/settings#participation         → Settings → Participation
//   /admin/settings/participation#threshold → that section, scrolled to the setting
//   /admin/settings#feedback              → Settings → Plugins, the Feedback panel open
//   /admin/settings/plugins#feedback      → the same
//   /admin#contact-civic-social           → Contact Civic.Social (an admin page, not a tab)
//
// Anchors are lower-case words joined by hyphens. Plugin ids keep their
// underscores in settings keys; their anchors use hyphens (meeting-summary).

import { PLUGIN_SECTION_ORDER } from "./hubSettingsSections.js";

export type PluginId = (typeof PLUGIN_SECTION_ORDER)[number];

/** The admin panel's tabs, in their order on the page. */
export const ADMIN_TABS = [
  { anchor: "processes", path: "/admin/reviews" },
  { anchor: "briefs", path: "/admin/briefs" },
  { anchor: "meeting-summaries", path: "/admin/meeting-summaries" },
  { anchor: "moderation", path: "/admin/moderation" },
  { anchor: "feedback", path: "/admin/feedback" },
  { anchor: "edits", path: "/admin/edits" },
  { anchor: "archived", path: "/admin/archived" },
  { anchor: "settings", path: "/admin/settings" },
] as const;

/** Admin pages that are not tabs (feedback routing, 2026-10-13). */
export const ADMIN_PAGES = [
  { anchor: "contact-civic-social", path: "/admin/contact-civic-social" },
] as const;

/** Settings' sections, in the order of its menu. Each is /admin/settings/<id>. */
export const SETTINGS_NAV = [
  { id: "identity", label: "Identity" },
  { id: "theme", label: "Appearance" },
  { id: "copy", label: "Copy & pages" },
  { id: "legal", label: "Legal" },
  { id: "email", label: "Email" },
  { id: "mode", label: "Mode" },
  { id: "sample", label: "Sample content" },
  { id: "admin-log", label: "Admin log" },
  { id: "people", label: "Admins" },
  { id: "officials", label: "Officials" },
  { id: "participation", label: "Participation" },
  { id: "plugins", label: "Plugins" },
] as const;

export type SettingsNavId = (typeof SETTINGS_NAV)[number]["id"];

/** Parts of a section a link can scroll to. */
export const SETTINGS_SUBSECTIONS: Partial<Record<SettingsNavId, readonly string[]>> = {
  mode: ["allowlist", "waitlist"],
  participation: ["threshold", "anonymity"],
};

/** A plugin's panel on Settings → Plugins. */
export function pluginAnchor(id: PluginId): string {
  return id.replace(/_/g, "-");
}

export const PLUGIN_ANCHORS: readonly string[] = PLUGIN_SECTION_ORDER.map(pluginAnchor);

export function isSettingsNavId(value: string): value is SettingsNavId {
  return SETTINGS_NAV.some((s) => s.id === value);
}

/**
 * Where an anchor on /admin or /admin/settings (with no section) leads, or
 * null for one that names nothing. On /admin a tab wins, so #feedback there is
 * the Feedback tab; on /admin/settings, #feedback is the plugin's panel.
 */
export function adminAnchorPath(anchor: string, on: "admin" | "settings"): string | null {
  const a = anchor.replace(/^#/, "").toLowerCase();
  if (!a) return null;
  if (on === "admin") {
    const tab = ADMIN_TABS.find((t) => t.anchor === a) ?? ADMIN_PAGES.find((p) => p.anchor === a);
    if (tab) return tab.path;
  }
  if (isSettingsNavId(a)) return `/admin/settings/${a}`;
  if (PLUGIN_ANCHORS.includes(a)) return `/admin/settings/plugins#${a}`;
  for (const [section, parts] of Object.entries(SETTINGS_SUBSECTIONS)) {
    if (parts?.includes(a)) return `/admin/settings/${section}#${a}`;
  }
  return null;
}
