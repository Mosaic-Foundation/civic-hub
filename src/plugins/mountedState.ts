// Which plugin packages are mounted (ADR-014). The loader
// (src/plugins/loader.ts) fills it; the plugin switch (isPluginEnabledSync),
// the plugin gate and the route gate read it, so a package that is not
// mounted reads as switched off everywhere the hub asks (routes, jobs, the
// feed, lists, the UI's switches). It imports only the configured
// packages' manifests (plain data) and the env reader, so the settings
// service can read it without a cycle, and the unit suite's setup can set it
// without loading the hub.
//
// A plugin is mounted when the package that owns it (the one whose manifest
// carries its Plugins section) is. A plugin no package provides (a hub
// feature) is not affected. Until the loader's first verdict nothing a
// package provides is mounted: nothing unverified runs.

import { isProductionEnv } from "../config/env.js";
import { PACKAGE_ENTRIES } from "../../config/plugins/manifests.js";

interface Declared {
  name: string;
  dir: string;
  type: string;
  plugin: string;
  /** Whether it owns its plugin (carries its Plugins section). */
  owner: boolean;
}

const declared: readonly Declared[] = PACKAGE_ENTRIES.map((e) => ({
  name: e.name,
  dir: e.dir,
  type: e.manifest.descriptor.type,
  plugin: e.manifest.descriptor.plugin,
  owner: "pluginSection" in e.manifest && e.manifest.pluginSection !== undefined,
}));

/** The configured package that provides a type (its name and directory), from the list alone. */
export function configuredPackageOfType(type: string): { name: string; dir: string } | undefined {
  return declared.find((d) => d.type === type);
}

let mounted: ReadonlySet<string> = new Set();
let everythingForTests = false;

/** The packages mounted now (the loader, at each verdict). */
export function recordMounted(names: Iterable<string>): void {
  mounted = new Set(names);
}

/**
 * The unit suite's setup: every loaded package counts as mounted, because
 * the catalog check needs a database. Refused where NODE_ENV is production.
 */
export function mountEverythingForTests(on: boolean): void {
  if (on && isProductionEnv()) throw new Error("mountEverythingForTests is for tests");
  everythingForTests = on;
}

export function everythingMountedForTests(): boolean {
  return everythingForTests;
}

/** Whether a loaded package is mounted. */
export function isPackageMounted(name: string): boolean {
  return everythingForTests || mounted.has(name);
}

/** Whether the package providing a type is mounted; true for a type no package provides. */
export function isTypeMounted(type: string): boolean {
  const p = declared.find((d) => d.type === type);
  return !p || isPackageMounted(p.name);
}

/** False for a package-provided plugin whose owning package is not mounted. */
export function pluginPackageMounted(plugin: string): boolean {
  const owner = declared.find((d) => d.plugin === plugin && d.owner);
  return !owner || isPackageMounted(owner.name);
}
