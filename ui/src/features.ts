// Every feature package's UI module (ADR-016; src/plugins/feature.ts), from
// config/featureUi.ts. A feature contributes what a process type's module does
// (routes, a settings panel) and what only a feature has: an Admin tab, an
// item in the Admin menu and a block on the About page. Each is shown only
// while the feature's switch is on.

import type { ComponentType, ReactNode } from "react";
import type { FormApi } from "./pages/settings/pluginFields";
import type { ProcessRoute } from "./processes/types";
import type { PluginId } from "./config/plugins";
import { FEATURE_UI_MODULES } from "../../config/featureUi";

export interface FeatureUi {
  /** Its hub feature: the switch everything below rides on. */
  feature: PluginId;
  routes: readonly ProcessRoute[];
  /** A tab in the admin tabs, and an item in the Admin menu and the navigation's Admin group (icon: navIcons.tsx). */
  adminTab?: { label: string; path: string; icon: string };
  settingsPanel?: (f: FormApi) => ReactNode;
  /** Drawn at the foot of the About page. */
  aboutBlock?: ComponentType;
  /**
   * A section of Admin → Activity, drawn after "By kind" for the period the
   * admin is looking at (YYYY-MM-DD, inclusive). For numbers that are not
   * residents taking part (the fediverse feature's followers), so they sit
   * apart from the participation counts.
   */
  activitySection?: ComponentType<{ start: string; end: string; label: string }>;
}

export const FEATURE_UI: readonly FeatureUi[] = FEATURE_UI_MODULES;

/** A feature's panel on the Plugins page, or null. */
export function featureSettingsPanel(id: string, f: FormApi): ReactNode | null {
  return FEATURE_UI.find((u) => u.feature === id)?.settingsPanel?.(f) ?? null;
}

/** The Activity sections of the features that are on. */
export function featureActivitySections(enabled: (id: PluginId) => boolean): ReadonlyArray<{ feature: PluginId; Section: NonNullable<FeatureUi["activitySection"]> }> {
  return FEATURE_UI.flatMap((u) => (u.activitySection && enabled(u.feature) ? [{ feature: u.feature, Section: u.activitySection }] : []));
}
