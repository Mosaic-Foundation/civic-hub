// settingsOf(): a package's settings, as the kernel keeps them (kernel step 1,
// docs/kernel/SURFACE.md, "Settings"). A plugin's settings are the hub's
// `plugin.<id>.*` keys, which its manifest's Plugins section declares; a
// package reads its own by name, and of the hub's own settings only the
// public ones (what anyone may read from /hub-config):
//
//   const settings = settingsOf("meeting_summary");
//   settings.get("source_url");        // plugin.meeting_summary.source_url
//   settings.enabled();                // mounted, and switched on for this hub
//   settings.public("copy.governing_body_name");
//
// Read per call, for the hub in scope then.

import { ForbiddenError } from "../errors/index.js";
import { isPublicKey } from "../models/hubSettings.js";
import { getSettingSync, isPluginEnabledSync } from "./hubSettings.js";

export interface OwnSettings {
  /** The plugin these settings are for. */
  readonly pluginId: string;
  /** One of its settings, `plugin.<id>.<name>`, or undefined when unset. */
  get(name: string): string | undefined;
  /** Whether the plugin is mounted and switched on for the hub in scope. */
  enabled(): boolean;
  /** One of the hub's public settings; any other key is refused. */
  public(key: string): string | undefined;
}

export function settingsOf(pluginId: string): OwnSettings {
  if (!/^[a-z_]+$/.test(pluginId)) throw new Error(`settingsOf(): "${pluginId}" is not a plugin id`);
  return {
    pluginId,
    get: (name) => getSettingSync(`plugin.${pluginId}.${name}`),
    enabled: () => isPluginEnabledSync(pluginId),
    public(key) {
      if (!isPublicKey(key)) throw new ForbiddenError(`${key} is not one of the hub's public settings`);
      return getSettingSync(key);
    },
  };
}
