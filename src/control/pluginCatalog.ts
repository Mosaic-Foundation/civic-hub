// @civic-raw-client-importer: the console reads every hub's plugin installs (hub_plugins) to show which hubs a package that is not mounted leaves without it.
// The console's plugin catalog (ADR-014): the operator's list of vetted
// package versions, approve and withdraw, and what this deployment mounts.
//
// A row arrives 'pending' with the migration `npm run catalog:add` wrote when
// the conformance suite passed. The operator approves it here (a fresh code,
// an audit row); from then on every server of this deployment mounts the
// package version whose files have exactly that hash, within a minute. A
// withdrawn row stops mounting it the same way. Nothing is deleted.
//
// Signatures (plugin session 2, ADR-015): approving signs the row with this
// deployment's catalog key (CIVIC_CATALOG_SIGNING_KEY) over (package,
// version, hash, grant). "Sign approved entries" signs every approved row
// not yet signed by the current key: the rows approved before signatures,
// and every row again after the key is rotated.

import { getDb } from "../db/client.js";
import { readApprovedCatalog, readCatalog, readCatalogRow, setCatalogSignature, setCatalogStatus, type CatalogRow } from "../db/pluginCatalog.js";
import { deploymentKeys, signatureVerifies, signRow, type SignatureMode } from "../plugins/signature.js";
import { packageVerdicts, refreshPackages, type PackageVerdict } from "../plugins/loader.js";
import { grantInPlainWords } from "../shared/pluginGrant.js";
import { loadedPackages } from "../plugins/loader.js";

export interface CatalogEntryView extends CatalogRow {
  /** Whether this deployment loads this package version with exactly these files. */
  matches_deployment: boolean;
  /** The grant, as a hub's Install confirmation words it. */
  grant: { can: string[]; cannot: string[] };
  /** Its signature verifies against this deployment's catalog keys. */
  signed: boolean;
}

export interface SigningView {
  mode: SignatureMode;
  /** This deployment's catalog key: its id and public half (what CIVIC_CATALOG_TRUSTED_KEYS takes after a rotation). */
  key: { id: string; public_key: string } | null;
  /** Why the key setting could not be used, when it was set. */
  problem: string | null;
  /** Approved entries not signed by this key. */
  unsigned: number;
}

export interface CatalogView {
  entries: CatalogEntryView[];
  /** What this deployment loads, and whether each is mounted (and why not). */
  deployment: PackageVerdict[];
  signing: SigningView;
}

/** Approved rows not signed by the current key: what "Sign approved entries" would sign. */
function needsSigning(row: CatalogRow): boolean {
  const keys = deploymentKeys();
  return row.status === "approved" && (!keys.signing || row.signature_key !== keys.signing.id || !signatureVerifies(row, keys.trusted));
}

function holdsOf(pkg: string): Record<string, string> {
  const p = loadedPackages().find((x) => x.pkg.name === pkg);
  return Object.fromEntries((p?.pkg.manifest.tables ?? []).map((t) => [t.name, t.holds]));
}

/** The entry's grant in plain words; a row whose grant cannot be read says so rather than failing the page. */
function grantWords(row: CatalogRow): { can: string[]; cannot: string[] } {
  try {
    return grantInPlainWords({ name: row.display_name, caps: row.capabilities, holds: holdsOf(row.package) });
  } catch {
    return { can: ["This entry's grant could not be read. Do not approve it."], cannot: [] };
  }
}

export async function catalogView(): Promise<CatalogView> {
  await refreshPackages();
  const deployment = packageVerdicts();
  const keys = deploymentKeys();
  const rows = await readCatalog();
  const entries = rows.map((row) => ({
    ...row,
    matches_deployment: deployment.some((v) => v.package === row.package && v.version === row.version && v.hash === row.hash),
    grant: grantWords(row),
    signed: signatureVerifies(row, keys.trusted),
  }));
  const signing: SigningView = {
    mode: keys.mode,
    key: keys.signing ? { id: keys.signing.id, public_key: keys.signing.publicKey } : null,
    problem: keys.problem ?? null,
    unsigned: rows.filter(needsSigning).length,
  };
  return { entries, deployment, signing };
}

export class CatalogStateError extends Error {}

/** Approve a pending entry, or a withdrawn one again (the caller has checked the fresh code). Returns the row before and after. */
export async function approveEntry(id: string, by: string, notes: string | null): Promise<{ before: CatalogRow; after: CatalogRow }> {
  const before = await readCatalogRow(id);
  if (!before) throw new CatalogStateError("No such catalog entry.");
  if (before.status === "approved") throw new CatalogStateError("This entry is already approved.");
  const keys = deploymentKeys();
  if (!keys.signing && keys.mode === "required") {
    throw new CatalogStateError(
      "This deployment has no catalog key (CIVIC_CATALOG_SIGNING_KEY) and signatures are required: an approval it cannot sign would mount nothing.",
    );
  }
  const signed = keys.signing ? signRow(before, keys.signing) : null;
  const after = await setCatalogStatus(id, ["pending", "withdrawn"], "approved", by, notes, signed);
  if (!after) throw new CatalogStateError("This entry changed while you were looking at it. Reload and try again.");
  await refreshPackages();
  return { before, after };
}

/**
 * Sign every approved entry not yet signed by this deployment's key (the
 * caller has checked the fresh code). Returns what it signed; an entry that
 * changed while it was being signed is left for the next run.
 */
export async function signApprovedEntries(): Promise<{ key: string; signed: Array<Pick<CatalogRow, "id" | "package" | "version" | "hash">> }> {
  const keys = deploymentKeys();
  if (!keys.signing) {
    throw new CatalogStateError(`This deployment has no catalog key to sign with (CIVIC_CATALOG_SIGNING_KEY${keys.problem ? `: ${keys.problem}` : " is not set"}).`);
  }
  const signed: Array<Pick<CatalogRow, "id" | "package" | "version" | "hash">> = [];
  for (const row of (await readApprovedCatalog()).filter(needsSigning)) {
    if (await setCatalogSignature(row, signRow(row, keys.signing))) {
      signed.push({ id: row.id, package: row.package, version: row.version, hash: row.hash });
    }
  }
  await refreshPackages();
  return { key: keys.signing.id, signed };
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
