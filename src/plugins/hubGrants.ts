// Each hub's approved grants (plugin session 2, ADR-015): the grant its admin
// approved for each package, as hub_plugins records it. A deployment runs one
// version of each package for every hub; a hub that has not approved a newer
// version's grant keeps the one it approved, and the seams enforce that one as
// well as the manifest's (src/plugins/grant.ts, src/plugins/host.ts). A
// package asks `host.allows()` before reaching for something a hub may not
// have approved yet, and does without it.
//
// Filled by the settings snapshot's loader (src/db/hubSettingsStore.ts) at
// the same settings version: a change to hub_plugins bumps the version
// (20261025000000), so an update reaches every server on its next request for
// that hub, as a settings change does. A load replaces a hub's grants; nothing
// else drops them, so a request in flight keeps what was read (a write that
// invalidates the settings cache mid-request does not leave it with none). Read synchronously by the seams; a hub
// not loaded yet, or a package it has no record of, is held to its manifest
// alone, as before.
//
// Imports nothing but types and the hub scope, so the emission path can ask.

import type { PluginCapabilities } from "../shared/pluginGrant.js";
import { currentHub } from "../config/hubContext.js";

const byHub = new Map<string, ReadonlyMap<string, PluginCapabilities>>();

/** Record a hub's approved grants, package by package (the settings loader). */
export function setHubGrants(hubId: string, grants: ReadonlyMap<string, PluginCapabilities>): void {
  byHub.set(hubId, grants);
}

/** Forget one hub's grants, or every hub's. */
export function clearHubGrants(hubId?: string): void {
  if (hubId) byHub.delete(hubId);
  else byHub.clear();
}

/** The grant the hub in scope approved for a package, or null (no hub in scope, not loaded, no record). */
export function hubGrantOf(packageName: string): PluginCapabilities | null {
  const hub = currentHub();
  if (!hub) return null;
  return byHub.get(hub.id)?.get(packageName) ?? null;
}
