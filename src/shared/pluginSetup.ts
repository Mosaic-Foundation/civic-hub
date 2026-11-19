// A plugin that is switched on but cannot do anything yet: "needs setup".
//
// The one place that rule is applied (Adam, 2026-10-07). Some plugins only
// work once the hub has told them something: today Meeting summaries and News
// sync need a source. Such a plugin stays switched on as the creator chose;
// what changes is:
//
//   - on the public site it appears only when it has something to show
//     (`shown`): Meeting summaries once the hub has a summary the public can
//     see (the sample counts) or a configured source, News sync once a
//     source is configured;
//   - in Settings → Plugins it carries a "Needs setup" badge with one line on
//     what is missing (`missing`).
//
// A plugin declares its own rule in its manifest's pluginSection.setup
// (kernel step 4; Meeting summaries' and News Sync's moved into their
// packages). The server evaluates it (src/services/pluginSetup.ts) because the
// settings it reads are admin-only, and serves the result as `plugin_setup` in
// /hub-config, which the UI reads (ui/src/config/plugins.tsx).
//
// Pure: no I/O, shared by the server and the UI.

import { PLUGIN_SECTION_INFO } from "./hubSettingsSections.js";

export interface PluginSetupRule {
  /** Every settings key `configured` reads, so a caller can fetch them first. */
  keys: readonly string[];
  /** Has the admin given it what it needs? Reads the hub's settings. */
  configured: (setting: (key: string) => string | undefined) => boolean;
  /**
   * The process type whose public items count as "something to show" even
   * while it is not configured. Omitted: only being configured does.
   */
  contentType?: string;
  /** One line for the Settings badge: what is missing. */
  missing: string;
}

/** Every plugin's setup rule, by plugin id: what its manifest declares. */
export const PLUGIN_SETUP: Readonly<Record<string, PluginSetupRule>> = Object.fromEntries(
  PLUGIN_SECTION_INFO.flatMap((p) => (p.setup ? [[p.id, p.setup] as const] : [])),
);

/** What /hub-config says about one plugin that needs setup. */
export interface PluginSetupStatus {
  /** One line on what is missing (the Settings badge). */
  missing: string;
  /** Whether the public site shows it anyway: it has something to show. */
  shown: boolean;
}

/**
 * The status of one plugin, or null when it needs nothing (no rule, or
 * configured). `hasContent` is asked only when the rule names a content type.
 */
export function pluginSetupStatus(
  id: string,
  setting: (key: string) => string | undefined,
  hasContent: (processType: string) => boolean,
): PluginSetupStatus | null {
  const rule = PLUGIN_SETUP[id];
  if (!rule || rule.configured(setting)) return null;
  return {
    missing: rule.missing,
    shown: rule.contentType ? hasContent(rule.contentType) : false,
  };
}

/** May the public site show this plugin? Pure, over the served statuses. */
export function pluginShownGiven(
  id: string,
  enabled: boolean,
  setup: Readonly<Record<string, PluginSetupStatus>> | undefined,
): boolean {
  if (!enabled) return false;
  const status = setup?.[id];
  return !status || status.shown;
}
