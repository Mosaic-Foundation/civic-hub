// The hub's process types as residents read them, and its sections in their
// one order (navigation slice, 2026-10-14).
//
// Both come from the hub config: `process_types` (the registry's display for
// every type) and the public settings `nav.layout` and `nav.section_order`.
// The ordering rules are shared and tested: src/shared/navSections.ts. Read at
// render, like the plugin switches: the whole tree re-renders when an admin's
// save refreshes the config (useHub(), config/hub.ts).

import { getLoadedHubConfig, setting } from "./hubConfig";
import { pluginEnabled, type PluginId } from "./plugins";
import { featureSectionShown } from "../features";
import {
  barSections,
  orderedSections,
  parseSectionOrder,
  type NavSection,
} from "../../../src/shared/navSections";
import type { ProcessTypeDisplay } from "../../../src/shared/typeDisplay";

export type { NavSection };

/**
 * Where the sections are drawn at desktop width: Left column ("sidebar"), Top
 * navigation ("top_tabs") or Three columns ("three_columns": the left column,
 * the feed and a right column of cards; ADR-019). Phones get the bottom bar
 * under each.
 */
export type NavLayout = "sidebar" | "top_tabs" | "three_columns";

/** Every registered type's display; empty when the config did not load. */
export function processTypes(): ProcessTypeDisplay[] {
  return getLoadedHubConfig()?.process_types ?? [];
}

/** One type's display, or undefined for a type this hub's registry doesn't know. */
export function typeDisplay(type: string | undefined): ProcessTypeDisplay | undefined {
  if (!type) return undefined;
  return processTypes().find((t) => t.type === type);
}

/** Unset (a hub made before the slice) is top tabs, as is a new hub (src/operator/hubs.ts). */
export function navLayout(): NavLayout {
  const stored = setting("nav.layout");
  return stored === "sidebar" || stored === "three_columns" ? stored : "top_tabs";
}

/**
 * Every section this hub has now, Feed first, in the hub's order. A plugin's
 * section is drawn while its switch is on and, for a feature's, while the
 * feature says this reader gets it (`admin` sees Members before its threshold).
 */
export function navSections(opts: { order?: readonly string[]; admin?: boolean } = {}): NavSection[] {
  return orderedSections({
    types: processTypes(),
    enabled: (plugin) => pluginEnabled(plugin as PluginId) && featureSectionShown(plugin, opts.admin ?? false),
    order: opts.order ?? parseSectionOrder(setting("nav.section_order")),
  });
}

/** The four sections on the phone's bar, before More. */
export function navBarSections(admin = false): NavSection[] {
  return barSections(navSections({ admin }));
}
