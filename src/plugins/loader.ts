// The plugin loader (plugin session 1, ADR-014).
//
// LOADING (once, when this module is first imported). The packages are the
// configured list, config/plugins/server.ts, written by `npm run plugins:sync`
// from config/plugins.json: the hosting layer's list, so the engine names no
// package. Each is checked, refused at startup with a message naming it:
//   - name, version and display name present and well formed; its manifest
//     and `server` there; every package it `requires` in the list;
//   - its handler declares its manifest's descriptor;
//   - a runner for each job its manifest declares, and no other.
// Its manifest is checked with every other by the registry
// (src/processes/registry.ts), which refuses a missing field, a malformed
// grant and a type, table or event type two packages claim, naming the
// package. Each package then gets its host (src/plugins/host.ts); its grant is
// the seams' from its manifest (src/plugins/grant.ts).
//
// MOUNTING (verifyPackages(), awaited before any request, job or script uses
// a package). A package is mounted only when an APPROVED catalog row records
// its name, version and the content hash of its files as they are now
// (src/plugins/hash.ts), and its manifest asks for nothing beyond the grant
// that row recorded. The same rule on every deployment, dev and production
// (Adam, 2026-10-25). Anything else, a package whose code changed after its
// approval included, is not mounted: its types read as switched off on every
// hub (src/services/pluginGate.ts), its routes answer 404, its jobs skip.
// Each unmounted package is reported once per server (`plugin.unmounted`),
// listed by /health (which stays "ok") and shown on the console's dashboard.
//
// The files are hashed once per server; the approved rows are read again
// after CATALOG_TTL_MS, so an approval in the console reaches every server
// within a minute.

import { resolve } from "node:path";
import { CONFIGURED_PACKAGES } from "../../config/plugins/server.js";
import type { ConfiguredPackage, PluginPackage, PluginServer } from "./package.js";
import { createHost } from "./host.js";
import { everythingMountedForTests, recordMounted } from "./mountedState.js";

export { isPackageMounted, isTypeMounted } from "./mountedState.js";
import { hashPackage } from "./hash.js";
import { beyondGrant } from "../shared/pluginGrant.js";
import { readApprovedCatalog, type CatalogRow } from "../db/pluginCatalog.js";
import { reportError } from "../utils/reportError.js";
import { pluginsUnverifiedEnabled } from "../config/devFlags.js";

/** Why a configured package was refused at startup. */
export class PackageError extends Error {
  constructor(entry: Pick<ConfiguredPackage, "dir"> & { pkg?: Partial<PluginPackage> }, message: string) {
    const who = typeof entry.pkg?.name === "string" && entry.pkg.name ? `${entry.pkg.name} (${entry.dir})` : entry.dir;
    super(`plugin package ${who}: ${message}`);
    this.name = "PackageError";
  }
}

export interface LoadedPackage {
  dir: string;
  pkg: PluginPackage;
  server: PluginServer;
  /** Its process type and the plugin (switch) it rides on. */
  type: string;
  plugin: string;
}

const NAME = /^@[a-z0-9-]+\/[a-z0-9._-]+$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

/** Check and load a configured list. Pure apart from registering grants; exported for the loader's tests. */
export function loadPackages(list: readonly ConfiguredPackage[]): LoadedPackage[] {
  const names = new Set<string>();
  for (const entry of list) {
    const p = entry.pkg as Partial<PluginPackage> | undefined;
    if (!p || typeof p !== "object") throw new PackageError(entry, "its index.ts exports no package");
    if (typeof p.name !== "string" || !NAME.test(p.name)) throw new PackageError(entry, 'missing or malformed "name" (an npm name, "@scope/name")');
    if (names.has(p.name)) throw new PackageError(entry, "a second package has this name");
    names.add(p.name);
    if (typeof p.version !== "string" || !SEMVER.test(p.version)) throw new PackageError(entry, 'missing or malformed "version" (semver, "1.2.3")');
    if (typeof p.displayName !== "string" || p.displayName.trim() === "") throw new PackageError(entry, 'missing "displayName", what the catalog and the Plugins page call it');
    if (!p.manifest || typeof p.manifest !== "object" || !p.manifest.descriptor) throw new PackageError(entry, 'missing "manifest"');
    if (!p.manifest.capabilities) throw new PackageError(entry, 'its manifest has no "capabilities" (the §4.1 grant)');
    if (typeof p.server !== "function") throw new PackageError(entry, 'missing "server(host)"');
  }
  const out: LoadedPackage[] = [];
  for (const entry of list) {
    const pkg = entry.pkg;
    for (const r of pkg.requires ?? []) {
      if (!names.has(r)) throw new PackageError(entry, `requires ${r}, which config/plugins.json does not list`);
    }
    const m = pkg.manifest;
    const server = pkg.server(createHost(pkg.name, m.capabilities));
    if (!server || !server.handler) throw new PackageError(entry, "server(host) returned no handler");
    if (server.handler.type !== m.descriptor.type) {
      throw new PackageError(entry, `its handler is for ${server.handler.type}, its manifest for ${m.descriptor.type}`);
    }
    if (server.handler.descriptor !== m.descriptor) throw new PackageError(entry, "its handler declares another descriptor than its manifest's");
    const declared = m.jobs.map((j) => j.id).sort();
    const runners = Object.keys(server.jobs ?? {}).sort();
    if (JSON.stringify(declared) !== JSON.stringify(runners)) {
      throw new PackageError(entry, `its manifest declares jobs [${declared.join(", ")}] and server(host) runs [${runners.join(", ")}]`);
    }
    for (const mount of [...(server.routes ?? []), ...(server.adminRoutes ?? [])]) {
      if (typeof mount.path !== "string" || !mount.path.startsWith("/") || !mount.router) {
        throw new PackageError(entry, `a route needs a path starting with "/" and a router (${String(mount.path)})`);
      }
    }
    out.push({ dir: entry.dir, pkg, server, type: m.descriptor.type, plugin: m.descriptor.plugin });
  }
  return out;
}

// Loaded on first use, not when this module is imported: a package's own
// imports reach the registry, and so this module, while the package itself is
// still being imported. src/app.ts asks at startup (through the registry).
let LOADED_NOW: readonly LoadedPackage[] | null = null;

function loaded(): readonly LoadedPackage[] {
  return (LOADED_NOW ??= loadPackages(CONFIGURED_PACKAGES));
}

/** Every loaded package, in configured order. */
export function loadedPackages(): readonly LoadedPackage[] {
  return loaded();
}

/** The loaded package that provides a process type. */
export function packageOfType(type: string): LoadedPackage | undefined {
  return loaded().find((p) => p.type === type);
}

// --- Mounting ------------------------------------------------------------------

export interface PackageVerdict {
  package: string;
  version: string;
  type: string;
  plugin: string;
  hash: string | null;
  mounted: boolean;
  /** Why it is not mounted, in a sentence an operator can act on. */
  reason?: string;
}

const CATALOG_TTL_MS = 60_000;

interface Verdicts {
  at: number;
  byName: Map<string, PackageVerdict>;
}

let hashes: Map<string, string | Error> | null = null;
let current: Verdicts | null = null;
let inflight: Promise<void> | null = null;
const reported = new Set<string>();

function hashesNow(): Map<string, string | Error> {
  if (!hashes) {
    hashes = new Map();
    for (const p of loaded()) {
      try {
        hashes.set(p.pkg.name, hashPackage(resolve(process.cwd(), p.dir)));
      } catch (err) {
        hashes.set(p.pkg.name, err instanceof Error ? err : new Error(String(err)));
      }
    }
  }
  return hashes;
}

/** The verdict for one package against the approved rows (pure; exported for tests). */
export function judge(p: Pick<LoadedPackage, "pkg" | "type" | "plugin">, hash: string | Error, approved: readonly CatalogRow[]): PackageVerdict {
  const base = { package: p.pkg.name, version: p.pkg.version, type: p.type, plugin: p.plugin };
  if (hash instanceof Error) {
    return { ...base, hash: null, mounted: false, reason: `its files could not be read to check them (${hash.message})` };
  }
  const rows = approved.filter((r) => r.package === p.pkg.name);
  const row = rows.find((r) => r.version === p.pkg.version && r.hash === hash);
  if (!row) {
    const sameVersion = rows.some((r) => r.version === p.pkg.version);
    return {
      ...base,
      hash,
      mounted: false,
      reason: sameVersion
        ? "its files changed since this version was approved; run `npm run catalog:add` and approve the new entry in the console"
        : "no approved catalog entry for this version; run `npm run catalog:add` and approve it in the console",
    };
  }
  const beyond = beyondGrant(p.pkg.manifest.capabilities, row.capabilities);
  if (beyond.length > 0) {
    return { ...base, hash, mounted: false, reason: `it asks for more than its approved grant: ${beyond.join(", ")}` };
  }
  return { ...base, hash, mounted: true };
}

async function refresh(): Promise<void> {
  const byName = new Map<string, PackageVerdict>();
  if (pluginsUnverifiedEnabled()) {
    // Development only (CIVIC_PLUGINS_UNVERIFIED): the files are still hashed,
    // so the verdict says what an approval would have to record.
    const h = hashesNow();
    for (const p of loaded()) {
      const hash = h.get(p.pkg.name)!;
      byName.set(p.pkg.name, {
        package: p.pkg.name, version: p.pkg.version, type: p.type, plugin: p.plugin,
        hash: hash instanceof Error ? null : hash, mounted: true,
        reason: "mounted without a catalog check (CIVIC_PLUGINS_UNVERIFIED, development only)",
      });
    }
  } else if (everythingMountedForTests()) {
    for (const p of loaded()) {
      byName.set(p.pkg.name, { package: p.pkg.name, version: p.pkg.version, type: p.type, plugin: p.plugin, hash: null, mounted: true });
    }
  } else {
    const h = hashesNow();
    let approved: CatalogRow[];
    try {
      approved = await readApprovedCatalog();
    } catch (err) {
      // The catalog could not be read: keep the last verdict if there is one,
      // since an approval does not expire; on a cold start nothing is mounted.
      reportError("plugin.catalog_unreadable", "the plugin catalog could not be read", {}, err);
      if (current) {
        current = { at: Date.now(), byName: current.byName };
        return;
      }
      approved = [];
    }
    for (const p of loaded()) byName.set(p.pkg.name, judge(p, h.get(p.pkg.name)!, approved));
  }
  for (const v of byName.values()) {
    const key = `${v.package}@${v.version}:${v.reason ?? ""}`;
    if (!v.mounted && !reported.has(key)) {
      reported.add(key);
      reportError("plugin.unmounted", `${v.package}@${v.version} is not mounted: ${v.reason}`, { package: v.package, version: v.version });
    }
  }
  current = { at: Date.now(), byName };
  recordMounted([...byName.values()].filter((v) => v.mounted).map((v) => v.package));
}

/** Decide (or refresh) which packages are mounted. Awaited before requests, jobs and scripts use them. */
export function verifyPackages(): Promise<void> {
  if (current && Date.now() - current.at < CATALOG_TTL_MS) return Promise.resolve();
  if (!inflight) inflight = refresh().finally(() => (inflight = null));
  return inflight;
}

/** Every package's verdict, in configured order ([] before the first verify). */
export function packageVerdicts(): PackageVerdict[] {
  return current ? loaded().map((p) => current!.byName.get(p.pkg.name)!).filter(Boolean) : [];
}

/** Forget the verdict and the hashes (the loader's tests). */
export function resetPackageVerdicts(): void {
  current = null;
  hashes = null;
  recordMounted([]);
}
