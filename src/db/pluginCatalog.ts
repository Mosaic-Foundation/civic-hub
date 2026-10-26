// @civic-raw-client-importer: the plugin catalog (plugin_catalog) is platform data: read by every hub's loader, written only by the console and the local approver.
// The console's catalog of plugin packages (20261025000000; ADR-014).
//
// The loader reads the approved rows to decide which packages to mount; the
// console lists, approves and withdraws. A hub never writes a row, and no
// hub role can read the table: only the service role, through here.

import { getDb } from "./client.js";
import type { PluginCapabilities } from "../shared/pluginGrant.js";

export type CatalogStatus = "pending" | "approved" | "withdrawn";

export interface CatalogRow {
  id: string;
  package: string;
  version: string;
  hash: string;
  display_name: string;
  plugin: string;
  process_type: string;
  capabilities: PluginCapabilities;
  conformance: { result: "passed"; ran_at: string; commit?: string; walked?: boolean };
  status: CatalogStatus;
  approved_by: string | null;
  approved_at: string | null;
  withdrawn_at: string | null;
  notes: string | null;
  created_at: string;
}

const COLUMNS =
  "id, package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, approved_by, approved_at, withdrawn_at, notes, created_at";

/** Every approved row. */
export async function readApprovedCatalog(): Promise<CatalogRow[]> {
  const { data, error } = await getDb().from("plugin_catalog").select(COLUMNS).eq("status", "approved");
  if (error) throw new Error(`plugin_catalog: ${error.message}`);
  return (data ?? []) as CatalogRow[];
}

/** Every row, newest first (the console's list). */
export async function readCatalog(): Promise<CatalogRow[]> {
  const { data, error } = await getDb()
    .from("plugin_catalog")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`plugin_catalog: ${error.message}`);
  return (data ?? []) as CatalogRow[];
}

/** One row by id, or null. */
export async function readCatalogRow(id: string): Promise<CatalogRow | null> {
  const { data, error } = await getDb().from("plugin_catalog").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`plugin_catalog: ${error.message}`);
  return (data as CatalogRow | null) ?? null;
}

/**
 * Approve a pending row, or withdraw an approved one. Conditional on its
 * status, so two operators cannot both act on it; returns the row as it now
 * is, or null when it was not in `from`.
 */
export async function setCatalogStatus(
  id: string,
  from: CatalogStatus,
  to: "approved" | "withdrawn",
  by: string,
  notes?: string | null,
): Promise<CatalogRow | null> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> =
    to === "approved" ? { status: "approved", approved_by: by, approved_at: now } : { status: "withdrawn", withdrawn_at: now };
  if (notes !== undefined) patch.notes = notes;
  const { data, error } = await getDb()
    .from("plugin_catalog")
    .update(patch)
    .eq("id", id)
    .eq("status", from)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`plugin_catalog: ${error.message}`);
  return (data as CatalogRow | null) ?? null;
}
