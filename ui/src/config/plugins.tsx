// Which plugins this hub has switched on, for the UI.
//
// `plugin.<id>.enabled` is in the public hub config for every plugin id, as
// "true" or "false" (src/services/hubSettings.ts getPublicSettings). Off
// means the plugin's nav items, tabs, pickers and pages are gone for this hub;
// the server answers its routes 404 as well (src/services/pluginGate.ts), so
// hiding here is presentation, never the only guard.
//
// Read at boot like the rest of the hub config: switching a plugin off takes
// effect on a visitor's next page load, and at once for the admin who
// switched it (Settings refreshes the config: refreshHubConfig()).
//
// A plugin can also be on but not set up yet (src/shared/pluginSetup.ts):
// the public site shows it only once it has something to show. Surfaces that
// advertise a plugin's content (a filter chip, a search chip) ask
// pluginShown(); its pages and admin tabs stay behind pluginEnabled().

import type { ReactElement } from "react";
import { getLoadedHubConfig, setting } from "./hubConfig";
import { pluginShownGiven, type PluginSetupStatus } from "../../../src/shared/pluginSetup";

export type PluginId =
  | "vote"
  | "proposal"
  | "project"
  | "announcement"
  | "brief"
  | "meeting_summary"
  | "wordcloud"
  | "conversation"
  | "assistant"
  | "digest"
  | "admin_digest"
  | "search"
  | "feedback"
  | "news_sync";

/** On unless the hub switched it off. A config that failed to load means on. */
export function pluginEnabled(id: PluginId): boolean {
  return setting(`plugin.${id}.enabled`) !== "false";
}

/** What is missing for a switched-on plugin that needs setup; null when ready. */
export function pluginSetup(id: PluginId): PluginSetupStatus | null {
  return getLoadedHubConfig()?.plugin_setup?.[id] ?? null;
}

/** On, and either set up or with something to show anyway. */
export function pluginShown(id: PluginId): boolean {
  return pluginShownGiven(id, pluginEnabled(id), getLoadedHubConfig()?.plugin_setup);
}

/** The plugin a process type belongs to (mirrors PROCESS_TYPE_PLUGINS). */
const PROCESS_TYPE_PLUGINS: Readonly<Record<string, PluginId>> = {
  "civic.vote": "vote",
  "civic.proposal": "proposal",
  "civic.project": "project",
  "civic.vote_results": "vote",
  "civic.brief": "brief",
  "civic.announcement": "announcement",
  "civic.meeting_summary": "meeting_summary",
  "civic.polis_deliberation": "conversation",
  "civic.wordcloud": "wordcloud",
};

export function processTypeEnabled(type: string): boolean {
  const plugin = PROCESS_TYPE_PLUGINS[type];
  return !plugin || pluginEnabled(plugin);
}

/** processTypeEnabled, and its plugin is shown (see pluginShown). */
export function processTypeShown(type: string): boolean {
  const plugin = PROCESS_TYPE_PLUGINS[type];
  return !plugin || pluginShown(plugin);
}

/** What a route of a switched-off plugin renders instead of its page. */
function PluginOff() {
  return (
    <main className="page-container" style={{ padding: "48px 16px", textAlign: "center" }}>
      <h1>Page not found</h1>
      <p>This hub does not offer this.</p>
      <p>
        <a href="/">Back to the home page</a>
      </p>
    </main>
  );
}

/** Wrap a route's element: the page when the plugin is on, "not found" when off. */
export function whenPlugin(id: PluginId, element: ReactElement): ReactElement {
  return pluginEnabled(id) ? element : <PluginOff />;
}
