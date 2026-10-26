// Installing and removing a plugin on a hub (plugin session 1, ADR-014): what
// the Plugins page's Install, Stop now and Wind down do.
//
// A plugin (the switch an admin sees: "Votes") is carried by one or more
// packages (Votes and Vote results). Its install record is hub_plugins, one
// row per package: the version and the grant the hub recorded, who installed
// or removed it and when. The runtime gate stays plugin.<id>.enabled; the
// record follows it (20261025000100), and apply_plugin_change() writes both
// together.
//
//   install     the catalog's approved grant for each package the deployment
//               mounts is recorded, and the plugin is switched on.
//   stop now    the plugin is switched off: what a switch-off always did. Its
//               processes are no longer served, nothing is deleted, and
//               installing again brings everything back.
//   wind down   nothing new of its kind can be started from now on
//               (assertProcessTypeCreatable); its open processes run to their
//               close and publish as normal; when the last one has closed, the
//               close job switches it off (finishWindDowns, from vote_close).
//               Offered for a plugin whose processes close at a deadline: one
//               whose items never close by themselves can only be stopped.
//
// A hub only ever sees plugins whose packages are approved in the catalog and
// mounted on this deployment.

import { ConflictError, NotFoundError, ValidationError } from "../errors/index.js";
import { currentHubId } from "../config/hubContext.js";
import { applyPluginChange, readHubPlugins, type HubPluginRow, type PluginChange } from "../db/hubPlugins.js";
import { invalidateHubSettings } from "../db/hubSettingsStore.js";
import { isPluginEnabled, isPluginEnabledSync, isPluginWindingDownSync, getSetting } from "./hubSettings.js";
import { countLiveProcessesByPlugin } from "./processService.js";
import { getManifests, processTypeDisplays } from "../processes/registry.js";
import { loadedPackages, packageVerdicts, verifyPackages, type PackageVerdict } from "../plugins/loader.js";
import { grantInPlainWords } from "../shared/pluginGrant.js";
import { orderAfterSwitchingOff } from "../shared/navSections.js";
import { KEYS } from "../models/hubSettings.js";
import { recordHubAdminAudit } from "./hubAdminAudit.js";
import { reportError } from "../utils/reportError.js";

export type InstallState = "installed" | "winding_down" | "removed" | "unavailable";

export interface PluginPackageView {
  package: string;
  version: string;
  display_name: string;
  type: string;
  /** The grant, as the Install confirmation says it. */
  grant: { can: string[]; cannot: string[] };
  /** When Civic.Social checked and approved this version; null when it is not mounted here. */
  approved_at: string | null;
  checked_at: string | null;
}

export interface PluginInstallView {
  plugin: string;
  name: string;
  state: InstallState;
  packages: PluginPackageView[];
  /** Its open processes (the wind-down waits for these). */
  open: number;
  /** Whether Wind down is offered: its processes close at a deadline. */
  wind_down_offered: boolean;
  installed_at: string | null;
  installed_by: string | null;
  removed_at: string | null;
  winding_down_since: string | null;
}

/** The process plugins packages provide, each with its packages, in the Plugins section's order. */
function pluginsWithPackages(): Array<{ plugin: string; name: string; packages: ReturnType<typeof loadedPackages>[number][] }> {
  const out = new Map<string, { plugin: string; name: string; order: number; packages: ReturnType<typeof loadedPackages>[number][] }>();
  for (const p of loadedPackages()) {
    const section = p.pkg.manifest.pluginSection;
    const entry = out.get(p.plugin) ?? { plugin: p.plugin, name: p.pkg.displayName, order: Number.MAX_SAFE_INTEGER, packages: [] };
    if (section) {
      entry.name = section.name;
      entry.order = section.order;
    }
    entry.packages.push(p);
    out.set(p.plugin, entry);
  }
  return [...out.values()].sort((a, b) => a.order - b.order);
}

function hasDeadlines(plugin: string): boolean {
  return getManifests().some((m) => m.descriptor.plugin === plugin && m.descriptor.deadline !== null);
}

/** A plugin's switch and wind-down flag, read fresh (not the request's snapshot): an install changes them mid-request. */
async function switchesNow(plugin: string): Promise<{ on: boolean; winding: boolean }> {
  const hubId = currentHubId();
  const [on, winding] = await Promise.all([
    isPluginEnabled(hubId, plugin),
    getSetting(hubId, `plugin.${plugin}.winding_down`).then((v) => v === "true"),
  ]);
  return { on, winding };
}

function view(
  entry: ReturnType<typeof pluginsWithPackages>[number],
  rows: readonly HubPluginRow[],
  verdicts: readonly PackageVerdict[],
  open: number,
  switches: { on: boolean; winding: boolean },
): PluginInstallView {
  const mine = rows.filter((r) => r.plugin === entry.plugin);
  const owner = mine.find((r) => r.package === entry.packages.find((p) => p.pkg.manifest.pluginSection)?.pkg.name) ?? mine[0];
  const mounted = entry.packages.every((p) => verdicts.find((v) => v.package === p.pkg.name)?.mounted);
  const state: InstallState = !mounted
    ? "unavailable"
    : !switches.on
      ? "removed"
      : switches.winding
        ? "winding_down"
        : "installed";
  return {
    plugin: entry.plugin,
    name: entry.name,
    state,
    packages: entry.packages.map((p) => {
      const v = verdicts.find((x) => x.package === p.pkg.name);
      const holds = Object.fromEntries(p.pkg.manifest.tables.map((t) => [t.name, t.holds]));
      return {
        package: p.pkg.name,
        version: p.pkg.version,
        display_name: p.pkg.displayName,
        type: p.type,
        grant: grantInPlainWords({ name: p.pkg.displayName, caps: p.pkg.manifest.capabilities, holds }),
        approved_at: v?.approvedAt ?? null,
        checked_at: v?.checkedAt ?? null,
      };
    }),
    open,
    wind_down_offered: hasDeadlines(entry.plugin),
    installed_at: owner?.installed_at ?? null,
    installed_by: owner?.installed_by ?? null,
    removed_at: owner?.removed_at ?? null,
    winding_down_since: owner?.winding_down_since ?? null,
  };
}

/**
 * Every package-provided plugin on the hub in scope, for the Plugins page. A
 * hub never sees a package the catalog has not approved: one that is not
 * mounted is listed only when the hub has it installed, so the admin is told
 * why it is gone.
 */
export async function listPluginInstalls(): Promise<PluginInstallView[]> {
  await verifyPackages();
  const [rows, counts] = await Promise.all([readHubPlugins(currentHubId()), countLiveProcessesByPlugin()]);
  const verdicts = packageVerdicts();
  const entries = pluginsWithPackages();
  const switches = await Promise.all(entries.map((e) => switchesNow(e.plugin)));
  return entries
    .map((e, i) => view(e, rows, verdicts, (counts as Record<string, number>)[e.plugin] ?? 0, switches[i]))
    .filter((v) => v.state !== "unavailable" || (v.installed_at !== null && v.removed_at === null));
}

async function one(plugin: string): Promise<PluginInstallView> {
  const found = (await listPluginInstalls()).find((p) => p.plugin === plugin);
  if (!found) throw new NotFoundError("No such plugin on this hub.", "unknown_plugin");
  return found;
}

/** The section order without this plugin's sections, when it is switched off (navigation slice). */
async function sectionOrderWithout(plugin: string): Promise<Array<{ key: string; value: string }>> {
  const order = orderAfterSwitchingOff({
    stored: await getSetting(currentHubId(), KEYS.NAV_SECTION_ORDER),
    switchedOff: [plugin],
    types: processTypeDisplays(),
  });
  return order === null ? [] : [{ key: KEYS.NAV_SECTION_ORDER, value: order }];
}

async function change(plugin: string, kind: PluginChange, actor: string): Promise<void> {
  const hubId = currentHubId();
  const settings: Array<{ key: string; value: string | null }> =
    kind === "install"
      ? [{ key: `plugin.${plugin}.enabled`, value: "true" }, { key: `plugin.${plugin}.winding_down`, value: null }]
      : kind === "wind_down"
        ? [{ key: `plugin.${plugin}.winding_down`, value: "true" }]
        : [
            { key: `plugin.${plugin}.enabled`, value: "false" },
            { key: `plugin.${plugin}.winding_down`, value: null },
            ...(await sectionOrderWithout(plugin)),
          ];
  const packages =
    kind === "install"
      ? loadedPackages()
          .filter((p) => p.plugin === plugin)
          .map((p) => ({ package: p.pkg.name, version: p.pkg.version, capabilities: p.pkg.manifest.capabilities }))
      : [];
  await applyPluginChange(hubId, { plugin, change: kind, packages, settings, actor });
  invalidateHubSettings(hubId);
}

/** Install a plugin: record each package's version and grant, and switch it on. */
export async function installPlugin(plugin: string, actor: { id: string; audit: string }): Promise<PluginInstallView> {
  const current = await one(plugin);
  if (current.state === "unavailable") {
    throw new ConflictError("This plugin is not available on this hub right now. Civic.Social has been told.", "plugin_unavailable");
  }
  if (current.state === "installed") return current;
  await change(plugin, "install", actor.id);
  await recordHubAdminAudit({
    actor: actor.audit,
    action: "plugin.install",
    before: { state: current.state },
    after: { plugin: current.name, state: "installed", packages: current.packages.map((p) => `${p.package}@${p.version}`) },
  });
  return one(plugin);
}

/** Remove a plugin: "stop" switches it off now; "wind_down" lets what is open run to its close first. */
export async function removePlugin(
  plugin: string,
  mode: unknown,
  actor: { id: string; audit: string },
): Promise<PluginInstallView> {
  if (mode !== "stop" && mode !== "wind_down") throw new ValidationError('Send { "mode": "stop" } or { "mode": "wind_down" }.');
  const current = await one(plugin);
  if (current.state === "removed" || current.state === "unavailable") return current;
  if (mode === "wind_down") {
    if (!current.wind_down_offered) {
      throw new ValidationError("What this plugin holds doesn't close by itself, so it can only be stopped.", "wind_down_not_offered");
    }
    // Nothing open: there is nothing to wait for, so it stops now.
    if (current.open === 0) mode = "stop";
  }
  await change(plugin, mode === "stop" ? "stop" : "wind_down", actor.id);
  await recordHubAdminAudit({
    actor: actor.audit,
    action: mode === "stop" ? "plugin.remove" : "plugin.wind_down",
    before: { state: current.state, open: current.open },
    after: { plugin: current.name, state: mode === "stop" ? "removed" : "winding_down" },
  });
  return one(plugin);
}

/**
 * The close job's last step (vote_close, every 15 minutes): each plugin
 * winding down on the hub in scope whose last open process has closed is
 * switched off. Returns the plugins switched off.
 */
export async function finishWindDowns(): Promise<string[]> {
  const winding = pluginsWithPackages().filter((e) => isPluginWindingDownSync(e.plugin) && isPluginEnabledSync(e.plugin));
  if (winding.length === 0) return [];
  const counts = (await countLiveProcessesByPlugin()) as Record<string, number>;
  const done: string[] = [];
  for (const e of winding) {
    if ((counts[e.plugin] ?? 0) > 0) continue;
    try {
      await change(e.plugin, "wound_down", "system:wind-down");
      await recordHubAdminAudit({
        actor: "system:wind-down",
        action: "plugin.remove",
        before: { state: "winding_down", open: 0 },
        after: { plugin: e.name, state: "removed", reason: "the last open item closed" },
      });
      done.push(e.plugin);
    } catch (err) {
      reportError("plugin.wind_down", `could not finish winding down ${e.plugin}`, { hub: currentHubId(), plugin: e.plugin }, err);
    }
  }
  return done;
}
