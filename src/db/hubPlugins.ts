// A hub's plugin installs (hub_plugins, 20261025000000; ADR-014): the record
// of which version of each package the hub installed and the grant it
// recorded, and the one function that changes an install together with the
// plugin's settings (apply_plugin_change). On the hub in scope, through
// forHub(), like every hub table.

import { forHub } from "./forHub.js";
import type { PluginCapabilities } from "../shared/pluginGrant.js";

export interface HubPluginRow {
  package: string;
  version: string;
  plugin: string;
  capabilities: PluginCapabilities;
  installed_at: string;
  installed_by: string;
  removed_at: string | null;
  removed_by: string | null;
  winding_down_since: string | null;
  winding_down_by: string | null;
}

export type PluginChange = "install" | "stop" | "wind_down" | "wound_down";

/** Every install row of the hub. */
export async function readHubPlugins(hubId: string): Promise<HubPluginRow[]> {
  return forHub(hubId)
    .from("hub_plugins")
    .select<HubPluginRow>(
      "package, version, plugin, capabilities, installed_at, installed_by, removed_at, removed_by, winding_down_since, winding_down_by",
    )
    .order("package", { ascending: true });
}

/** One change to one plugin, with its settings, in one transaction. */
export async function applyPluginChange(
  hubId: string,
  input: {
    plugin: string;
    change: PluginChange;
    packages: ReadonlyArray<{ package: string; version: string; capabilities: PluginCapabilities }>;
    settings: ReadonlyArray<{ key: string; value: string | null }>;
    actor: string;
  },
): Promise<number> {
  return forHub(hubId).rpc<number>("apply_plugin_change", {
    p_plugin: input.plugin,
    p_change: input.change,
    p_packages: input.packages,
    p_settings: input.settings,
    p_actor: input.actor,
  });
}
