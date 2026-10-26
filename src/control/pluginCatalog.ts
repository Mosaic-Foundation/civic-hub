// @civic-raw-client-importer: the console reads every hub's plugin installs (hub_plugins) to show which hubs a package that is not mounted leaves without it.
// The console's plugin catalog (ADR-014): the operator's list of vetted
// package versions, approve and withdraw, and what this deployment mounts.
//
// A row arrives 'pending' with the migration `npm run catalog:add` wrote when
// the conformance suite passed. The operator approves it here (a fresh code,
// an audit row); from then on every server of this deployment mounts the
// package version whose files have exactly that hash, within a minute. A
// withdrawn row stops mounting it the same way. Nothing is deleted.

import { getDb } from "../db/client.js";
import { readCatalog, readCatalogRow, setCatalogStatus, type CatalogRow } from "../db/pluginCatalog.js";
import { packageVerdicts, refreshPackages, type PackageVerdict } from "../plugins/loader.js";
import { grantInPlainWords } from "../shared/pluginGrant.js";
import { loadedPackages } from "../plugins/loader.js";

export interface CatalogEntryView extends CatalogRow {
  /** Whether this deployment loads this package version with exactly these files. */
  matches_deployment: boolean;
  /** The grant, as a hub's Install confirmation words it. */
  grant: { can: string[]; cannot: string[] };
}

export interface CatalogView {
  entries: CatalogEntryView[];
  /** What this deployment loads, and whether each is mounted (and why not). */
  deployment: PackageVerdict[];
}

function holdsOf(pkg: string): Record<string, string> {
  const p = loadedPackages().find((x) => x.pkg.name === pkg);
  return Object.fromEntries((p?.pkg.manifest.tables ?? []).map((t) => [t.name, t.holds]));
}

export async function catalogView(): Promise<CatalogView> {
  await refreshPackages();
  const deployment = packageVerdicts();
  const entries = (await readCatalog()).map((row) => ({
    ...row,
    matches_deployment: deployment.some((v) => v.package === row.package && v.version === row.version && v.hash === row.hash),
    grant: grantInPlainWords({ name: row.display_name, caps: row.capabilities, holds: holdsOf(row.package) }),
  }));
  return { entries, deployment };
}

export class CatalogStateError extends Error {}

/** Approve a pending entry, or a withdrawn one again (the caller has checked the fresh code). Returns the row before and after. */
export async function approveEntry(id: string, by: string, notes: string | null): Promise<{ before: CatalogRow; after: CatalogRow }> {
  const before = await readCatalogRow(id);
  if (!before) throw new CatalogStateError("No such catalog entry.");
  if (before.status === "approved") throw new CatalogStateError("This entry is already approved.");
  const after = await setCatalogStatus(id, ["pending", "withdrawn"], "approved", by, notes);
  if (!after) throw new CatalogStateError("This entry changed while you were looking at it. Reload and try again.");
  await refreshPackages();
  return { before, after };
}

/** Withdraw an approved entry: the deployment stops mounting that version. */
export async function withdrawEntry(id: string, by: string, notes: string | null): Promise<{ before: CatalogRow; after: CatalogRow }> {
  const before = await readCatalogRow(id);
  if (!before) throw new CatalogStateError("No such catalog entry.");
  if (before.status !== "approved") throw new CatalogStateError(`This entry is ${before.status}; only an approved entry can be withdrawn.`);
  const after = await setCatalogStatus(id, ["approved"], "withdrawn", by, notes);
  if (!after) throw new CatalogStateError("This entry changed while you were looking at it. Reload and try again.");
  await refreshPackages();
  return { before, after };
}

/**
 * The dashboard's Plugins section: each package this deployment loads but
 * does not mount, with why and the hubs that have it installed (they are
 * without it until the operator acts).
 */
export async function loadPluginGaps(): Promise<{
  mounted: number;
  unmounted: Array<{ package: string; version: string; reason: string; hubs: string[] }>;
  pending: number;
}> {
  await refreshPackages();
  const verdicts = packageVerdicts();
  const gaps = verdicts.filter((v) => !v.mounted);
  const out: Array<{ package: string; version: string; reason: string; hubs: string[] }> = [];
  for (const v of gaps) {
    const { data, error } = await getDb()
      .from("hub_plugins")
      .select("hub_id")
      .eq("package", v.package)
      .is("removed_at", null)
      .order("hub_id", { ascending: true })
      .limit(1000);
    if (error) throw new Error(`hub_plugins: ${error.message}`);
    out.push({ package: v.package, version: v.version, reason: v.reason ?? "", hubs: (data ?? []).map((r) => String(r.hub_id)) });
  }
  const pending = (await readCatalog()).filter((r) => r.status === "pending").length;
  return { mounted: verdicts.length - gaps.length, unmounted: out, pending };
}
