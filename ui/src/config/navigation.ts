// The hub's process types as residents read them, and its sections in their
// one order (navigation slice, 2026-10-14).
//
// Both come from the hub config: `process_types` (the registry's display for
// every type) and the public settings `nav.layout` and `nav.section_order`.
// The ordering rules are shared and tested: src/shared/navSections.ts. Read at
// render, like the plugin switches: the whole tree re-renders when an admin's
// save refreshes the config (useHubConfig in App.tsx).

import { getLoadedHubConfig, setting } from "./hubConfig";
import { pluginEnabled, type PluginId } from "./plugins";
import {
  barSections,
  orderedSections,
  parseSectionOrder,
  type NavSection,
} from "../../../src/shared/navSections";
import type { ProcessTypeDisplay } from "../../../src/shared/typeDisplay";

export type { NavSection };

/** Where the sections are drawn at desktop width. Phones get the bottom bar under either. */
export type NavLayout = "sidebar" | "top_tabs";

/** Every registered type's display; empty when the config did not load. */
export function processTypes(): ProcessTypeDisplay[] {
  return getLoadedHubConfig()?.process_types ?? [];
}

/** One type's display, or undefined for a type this hub's registry doesn't know. */
export function typeDisplay(type: string | undefined): ProcessTypeDisplay | undefined {
  if (!type) return undefined;
  return processTypes().find((t) => t.type === type);
}

/** Unset (a hub made before the slice) is top tabs; new hubs are created with sidebar. */
export function navLayout(): NavLayout {
  return setting("nav.layout") === "sidebar" ? "sidebar" : "top_tabs";
}

/**
 * Whether the Members page is there for this reader: the Members plugin on,
 * and either past its threshold (or shown anyway) or the reader an admin.
 */
export function membersPageShown(admin: boolean): boolean {
  if (!pluginEnabled("members")) return false;
  return admin || getLoadedHubConfig()?.members?.page_shown !== false;
}

/** Every section this hub has now, Feed first, in the hub's order. `admin` sees Members before its threshold. */
export function navSections(opts: { order?: readonly string[]; admin?: boolean } = {}): NavSection[] {
  return orderedSections({
    types: processTypes(),
    enabled: (plugin) => (plugin === "members" ? membersPageShown(opts.admin ?? false) : pluginEnabled(plugin as PluginId)),
    order: opts.order ?? parseSectionOrder(setting("nav.section_order")),
  });
}

/** The four sections on the phone's bar, before More. */
export function navBarSections(admin = false): NavSection[] {
  return barSections(navSections({ admin }));
}
