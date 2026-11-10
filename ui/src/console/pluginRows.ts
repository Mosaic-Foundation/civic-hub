// The console's Plugins section as one row per plugin (console slice,
// 2026-11-09): every catalog entry of a package, newest version first, beside
// what this deployment loads of it. Pure, so the grouping is tested apart
// from the page.

import type { PluginCatalogEntry, PluginVerdict } from "./api";

export interface PluginRow {
  package: string;
  /** The newest entry's name, else the package's. */
  name: string;
  /** Newest version first; withdrawn and older ones are kept, as the audit trail. */
  versions: PluginCatalogEntry[];
  /** What this deployment loads of the package, if it loads it. */
  deployment: PluginVerdict | null;
  /** The entry the deployment runs: its version and files, mounted. */
  running: PluginCatalogEntry | null;
  /** The newest version waiting for approval, when it is newer than every approved one. */
  pending: PluginCatalogEntry | null;
}

/** Semver-ish order, newest first: numeric parts compared as numbers; a pre-release before its release. */
export function compareVersionsDesc(a: string, b: string): number {
  const [aCore, aPre = ""] = a.split("-", 2);
  const [bCore, bPre = ""] = b.split("-", 2);
  const ap = aCore!.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const bp = bCore!.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const d = (bp[i] ?? 0) - (ap[i] ?? 0);
    if (d !== 0) return d;
  }
  if (aPre === bPre) return 0;
  if (!aPre) return -1;
  if (!bPre) return 1;
  return bPre.localeCompare(aPre, undefined, { numeric: true });
}

export function pluginRows(entries: readonly PluginCatalogEntry[], deployment: readonly PluginVerdict[]): PluginRow[] {
  const packages = new Set<string>([...entries.map((e) => e.package), ...deployment.map((v) => v.package)]);
  const rows: PluginRow[] = [];
  for (const pkg of packages) {
    const versions = entries
      .filter((e) => e.package === pkg)
      .sort((a, b) => compareVersionsDesc(a.version, b.version) || b.created_at.localeCompare(a.created_at));
    const verdict = deployment.find((v) => v.package === pkg) ?? null;
    const running = verdict?.mounted
      ? versions.find((e) => e.status === "approved" && e.version === verdict.version && e.hash === verdict.hash) ?? null
      : null;
    const newestApproved = versions.find((e) => e.status === "approved");
    const newestPending = versions.find((e) => e.status === "pending") ?? null;
    const pending =
      newestPending && (!newestApproved || compareVersionsDesc(newestPending.version, newestApproved.version) <= 0)
        ? newestPending
        : null;
    rows.push({ package: pkg, name: versions[0]?.display_name ?? verdict?.plugin ?? pkg, versions, deployment: verdict, running, pending });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
