// "Needs setup" for one hub: the rule in src/shared/pluginSetup.ts, evaluated
// against that hub's settings and content. Served in /hub-config as
// `plugin_setup`, so the public site and Settings → Plugins agree.
//
// Only plugins that are switched on are reported: a switched-off plugin is
// gone, which is a different thing. The content count runs only for a plugin
// that has a rule naming a content type and is not configured, so a hub with
// its sources set pays for no query.

import { forHub } from "../db/forHub.js";
import { getSetting, isPluginEnabled } from "./hubSettings.js";
import { nonPublicStatusFilter } from "./processLifecycle.js";
import {
  PLUGIN_SETUP,
  pluginSetupStatus,
  type PluginSetupStatus,
} from "../shared/pluginSetup.js";

export async function pluginSetupFor(hubId: string): Promise<Record<string, PluginSetupStatus>> {
  const out: Record<string, PluginSetupStatus> = {};
  for (const [id, rule] of Object.entries(PLUGIN_SETUP)) {
    if (!(await isPluginEnabled(hubId, id))) continue;
    const values: Record<string, string | undefined> = {};
    for (const key of rule.keys) values[key] = await getSetting(hubId, key);
    const reader = (key: string) => values[key];

    const configured = rule.configured(reader);
    let hasContent = false;
    if (!configured && rule.contentType) {
      const n = await forHub(hubId)
        .from("processes")
        .count()
        .eq("type", rule.contentType)
        .not("status", "in", nonPublicStatusFilter());
      hasContent = n > 0;
    }
    const status = pluginSetupStatus(id, reader, () => hasContent);
    if (status) out[id] = status;
  }
  return out;
}
