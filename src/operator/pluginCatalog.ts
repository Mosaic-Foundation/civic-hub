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
// Signatures (plugin session 2, ADR-015; the console split, step 2): the
// console signs an approval with its catalog key over (package, version,
// hash, grant) and hands the signature in; the hub stores it only if it
// verifies against a key this deployment trusts (src/plugins/signature.ts).
// The hub never holds the private key. "Sign approved entries" is the
// console signing every approved row not yet signed by its current key and
// storing the signatures here (storeSignatures).

import { getDb } from "../db/client.js";
import {
  applyRequiredVersion,
  readApprovedCatalog,
  readCatalog,
  readCatalogRow,
  setCatalogRequired,
  setCatalogSignature,
  setCatalogStatus,
  type CatalogRow,
} from "../db/pluginCatalog.js";
import { deploymentKeys, signatureVerifies, type Signature, type SignatureMode } from "../plugins/signature.js";
import { packageVerdicts, refreshPackages, type PackageVerdict } from "../plugins/loader.js";
import { grantInPlainWords } from "../shared/pluginGrant.js";
import { loadedPackages } from "../plugins/loader.js";
import { isFirstPartyName } from "../shared/firstParty.js";

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
  /** The catalog key approvals are signed with: its id and public half (what CIVIC_CATALOG_PUBLIC_KEY takes; CIVIC_CATALOG_TRUSTED_KEYS after a rotation). */
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
  return row.status === "approved" && (!keys.primary || row.signature_key !== keys.primary.id || !signatureVerifies(row, keys.trusted));
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
    key: keys.primary ? { id: keys.primary.id, public_key: keys.primary.publicKey } : null,
    problem: keys.problem ?? null,
    unsigned: rows.filter(needsSigning).length,
  };
  return { entries, deployment, signing };
}

export class CatalogStateError extends Error {}

/**
 * The console's signature for a row, checked: it must verify against a key
 * this deployment trusts. Null (the console has no key) only while
 * signatures are not required.
 */
function checkedSignature(row: CatalogRow, signed: Signature | null): Signature | null {
  const keys = deploymentKeys();
  if (!signed) {
    if (keys.mode === "required") {
      throw new CatalogStateError(
        "The console has no catalog key (CIVIC_CATALOG_SIGNING_KEY) and signatures are required: an approval it cannot sign would mount nothing.",
      );
    }
    return null;
  }
  if (!signatureVerifies({ ...row, ...signed }, keys.trusted)) {
    throw new CatalogStateError(
      `The console's signature (${signed.signature_key}) does not verify against a key this deployment trusts. Set CIVIC_CATALOG_PUBLIC_KEY to the console's key.`,
    );
  }
  return signed;
}

/**
 * Approve a pending entry, or a withdrawn one again, with the console's
 * signature over it (the caller has checked the fresh code). Returns the row
 * before and after.
 */
export async function approveEntry(
  id: string,
  by: string,
  notes: string | null,
  signed: Signature | null,
): Promise<{ before: CatalogRow; after: CatalogRow }> {
  const before = await readCatalogRow(id);
  if (!before) throw new CatalogStateError("No such catalog entry.");
  if (before.status === "approved") throw new CatalogStateError("This entry is already approved.");
  const signature = checkedSignature(before, signed);
  const after = await setCatalogStatus(id, ["pending", "withdrawn"], "approved", by, notes, signature);
  if (!after) throw new CatalogStateError("This entry changed while you were looking at it. Reload and try again.");
  await refreshPackages();
  return { before, after };
}

export interface ReleaseRequest {
  package: string;
  version: string;
  hash: string;
}

export type ReleaseOutcome =
  | { package: string; version: string; result: "approved"; id: string; signature_key: string | null }
  | { package: string; version: string; result: "pending"; reason: string };

/** One requested entry, as the hub sees it: a row a release may approve, or why not. */
export type ReleasePlanItem =
  | { package: string; version: string; result: "approve"; row: CatalogRow }
  | { package: string; version: string; result: "pending"; reason: string };

/**
 * A release's approval (ADR-015 amendment, console slice): scripts/release.sh
 * has checked that CI ran green on `commit` and that each entry's fingerprint
 * is the files at that commit. Here, which of them a release may approve: a
 * first-party package's entry, still pending, with that very fingerprint.
 * The console signs each and approves it as its Approve does, by
 * `release@<commit>`; anything else stays pending, with the reason, for the
 * operator.
 */
export async function releasePlan(requests: readonly ReleaseRequest[]): Promise<ReleasePlanItem[]> {
  const rows = await readCatalog();
  return requests.map((want): ReleasePlanItem => {
    const pending = (reason: string): ReleasePlanItem => ({ package: want.package, version: want.version, result: "pending", reason });
    if (!isFirstPartyName(want.package)) return pending("Not a first-party package: the operator approves it in the console.");
    const forVersion = rows.filter((r) => r.package === want.package && r.version === want.version);
    const row = forVersion.find((r) => r.hash === want.hash);
    if (!row) {
      return pending(
        forVersion.length
          ? `The catalog's fingerprint for this version (${forVersion.map((r) => r.hash).join(", ")}) is not the one CI tested (${want.hash}).`
          : "No catalog entry for this version.",
      );
    }
    if (row.status !== "pending") return pending(`This entry is ${row.status}; a release approves only a pending one.`);
    return { package: want.package, version: want.version, result: "approve", row };
  });
}

/**
 * Store the console's signatures for approved entries ("Sign approved
 * entries": the rows approved before signatures, and every row again after
 * a rotation). Each must verify against a trusted key over the row as it is
 * now; an entry that changed meanwhile is left for the next run. Returns
 * what was stored.
 */
export async function storeSignatures(
  items: ReadonlyArray<{ id: string } & Signature>,
): Promise<Array<Pick<CatalogRow, "id" | "package" | "version" | "hash">>> {
  const stored: Array<Pick<CatalogRow, "id" | "package" | "version" | "hash">> = [];
  for (const item of items) {
    const row = await readCatalogRow(item.id);
    if (!row || row.status !== "approved") continue;
    const signed = checkedSignature(row, { signature: item.signature, signature_key: item.signature_key });
    if (signed && (await setCatalogSignature(row, signed))) {
      stored.push({ id: row.id, package: row.package, version: row.version, hash: row.hash });
    }
  }
  await refreshPackages();
  return stored;
}

/**
 * Mark an approved entry required, or not (ADR-015): a required version is
 * recorded on every hub on an older one, now when this deployment runs it,
 * else when a server first mounts it, with a notice on the hub's Plugins
 * page. No hub's admin is asked. Returns how many hubs moved now.
 */
export async function setEntryRequired(id: string, required: boolean): Promise<{ before: CatalogRow; after: CatalogRow; moved: number }> {
  const before = await readCatalogRow(id);
  if (!before) throw new CatalogStateError("No such catalog entry.");
  if (before.status !== "approved") throw new CatalogStateError("Only an approved entry can be marked required.");
  const after = await setCatalogRequired(id, required);
  if (!after) throw new CatalogStateError("This entry changed while you were looking at it. Reload and try again.");
  await refreshPackages();
  const running = packageVerdicts().some((v) => v.mounted && v.package === after.package && v.version === after.version && v.hash === after.hash);
  const moved = after.required && running ? await applyRequiredVersion(after) : 0;
  return { before, after, moved };
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
