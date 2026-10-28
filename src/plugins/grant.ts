// The capability grant, enforced at the hub's seams (plugin architecture
// §5a Stage 1; ADR-014). A Tier 1 package runs in the hub's process, so this
// is not isolation: it is the host's own seams refusing what a package's grant
// does not name, plus the lint that keeps a package from going around them
// (civic/package-boundary). Three reaches are checked:
//
//   a table     the package's store gets grantedDb(): forHub() on the hub in
//               scope, refusing every table its grant does not list;
//   an adapter  the package gets its adapters from its host (src/plugins/host.ts),
//               which hands out only the ones its grant lists;
//   an event    the one emission path (src/events/eventEmitter.ts) refuses an
//               event about a process of the package's type whose type its
//               grant does not list. The hub's own lifecycle events
//               (HOST_EVENT_TYPES) are the hub's, emitted for every type.
//
// Each refusal throws GrantRefusedError and is reported through the errors
// adapter (`plugin.grant.<reach>`), in production as everywhere else: a grant
// is a boundary, not a description (Adam, 2026-10-25).
//
// The grant enforced is the one in the package's manifest. The loader mounts
// a package only when that grant is no more than its approved catalog row
// records. Since plugin session 2 (ADR-015) a deployment runs one version of
// each package for every hub, and each hub records the grant its admin
// approved (src/plugins/hubGrants.ts): a hub that has not approved a newer
// version's grant is held to the one it approved, at every seam.
//
// Imports only the error types, the reporter and the configured packages'
// manifests (plain data), so the emission path can ask without a cycle. Every
// configured package's grant is known from its manifest before any package
// code has loaded.

import { CivicError } from "../errors/index.js";
import { reportError } from "../utils/reportError.js";
import type { GrantableAdapter, PluginCapabilities } from "../shared/pluginGrant.js";
import { PACKAGE_ENTRIES } from "../../config/plugins/manifests.js";
import { hubGrantOf } from "./hubGrants.js";

export type GrantReach = "table" | "adapter" | "event";

/** A package reached past its grant. A fault in the package, so a 500 to the caller; the operators are told. */
export class GrantRefusedError extends CivicError {
  constructor(
    readonly packageName: string,
    readonly reach: GrantReach,
    readonly what: string,
  ) {
    super(500, "plugin_grant_refused", "Something went wrong on our side. Please try again in a moment.");
  }
}

interface Granted {
  packageName: string;
  caps: PluginCapabilities;
}

const BY_TYPE = new Map<string, Granted>(
  PACKAGE_ENTRIES.map((e) => [e.manifest.descriptor.type, { packageName: e.name, caps: e.manifest.capabilities }]),
);

/** Record a package's grant under its process type (a test's own package). */
export function registerGrant(processType: string, packageName: string, caps: PluginCapabilities): void {
  BY_TYPE.set(processType, { packageName, caps });
}

/** The grant of the package that owns a process type, or undefined for a type no package owns. */
export function grantOfType(processType: string): Granted | undefined {
  return BY_TYPE.get(processType);
}

/**
 * Whether the package that owns `processType` may use `adapter` on the hub in
 * scope: in its grant, and in the grant that hub's admin approved (no record:
 * its manifest decides). False for a type no package owns.
 */
export function typeMayUseAdapter(processType: string, adapter: GrantableAdapter): boolean {
  const g = BY_TYPE.get(processType);
  if (!g || !g.caps.adapters.includes(adapter)) return false;
  const approved = hubGrantOf(g.packageName);
  return !approved || approved.adapters.includes(adapter);
}

/** Refuse and report one reach past a grant. */
export function refuseReach(packageName: string, reach: GrantReach, what: string): never {
  reportError(
    `plugin.grant.${reach}`,
    `${packageName} reached past its capability grant: ${reach} ${what}`,
    { package: packageName, reach, what },
  );
  throw new GrantRefusedError(packageName, reach, what);
}

/**
 * The emission path's check: an event of `eventType` about a process of
 * `processType`. Passes for a type no package owns, and for the hub's own
 * lifecycle events (`hostEventTypes`).
 */
export function checkEmissionGrant(processType: string, eventType: string, hostEventTypes: readonly string[]): void {
  const g = BY_TYPE.get(processType);
  if (!g || hostEventTypes.includes(eventType)) return;
  if (!g.caps.activities.emit.includes(eventType)) refuseReach(g.packageName, "event", eventType);
  const approved = hubGrantOf(g.packageName);
  if (approved && !approved.activities.emit.includes(eventType)) {
    refuseReach(g.packageName, "event", `${eventType} (not in the grant this hub approved)`);
  }
}
