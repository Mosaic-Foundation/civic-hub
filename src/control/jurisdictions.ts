// @civic-raw-client-importer: the super admin reads the platform's jurisdiction reference list and every hub's link to it.
// The jurisdiction reference list, as the console's create and edit forms
// use it: states, a type-ahead over one state's jurisdictions of one type,
// which hubs already serve a jurisdiction, and the slug to suggest.
//
// Plan: BUILD-PLAN-multi-tenant.md → "Jurisdictions". The table
// (20260927000000) is read-only reference data loaded by
// scripts/load-jurisdictions.ts; the console only reads it, as the service
// role. Nothing here names a place: every name is a row.

import { getDb } from "../db/client.js";
import { hubSlugRejectionReason } from "../models/hub.js";
import {
  REFERENCE_JURISDICTION_TYPES,
  isReferenceJurisdictionType,
  type ReferenceJurisdictionType,
} from "../shared/jurisdictionType.js";
import { baseName, slugCandidates } from "../shared/jurisdictionNames.js";
import { ControlInputError, hostnameTakenBy } from "./hubs.js";
import { platformDomain } from "./config.js";

export interface Jurisdiction {
  ocd_id: string;
  census_geoid: string;
  state: string;
  type: ReferenceJurisdictionType;
  official_name: string;
  display_name: string;
}

const COLUMNS = "ocd_id, census_geoid, state, type, official_name, display_name";

/** A hub that already serves a jurisdiction: shown as information, never refused. */
export interface ServingHub {
  id: string;
  name: string;
  archived: boolean;
}

export type JurisdictionMatch = Jurisdiction & { hubs: ServingHub[] };

export async function getJurisdiction(ocdId: string): Promise<Jurisdiction | null> {
  const { data, error } = await getDb().from("jurisdictions").select(COLUMNS).eq("ocd_id", ocdId).maybeSingle();
  if (error) throw new Error(`jurisdictions read failed: ${error.message}`);
  return (data as Jurisdiction | null) ?? null;
}

/** Every state row, by name. Empty when the list has not been loaded. */
export async function listStates(): Promise<Jurisdiction[]> {
  const { data, error } = await getDb()
    .from("jurisdictions")
    .select(COLUMNS)
    .eq("type", "state")
    .order("official_name", { ascending: true });
  if (error) throw new Error(`jurisdictions read failed: ${error.message}`);
  return (data ?? []) as Jurisdiction[];
}

/** Hubs pointing at each of these jurisdictions. */
export async function hubsServing(ocdIds: readonly string[]): Promise<Map<string, ServingHub[]>> {
  const out = new Map<string, ServingHub[]>();
  if (ocdIds.length === 0) return out;
  const { data, error } = await getDb()
    .from("hubs")
    .select("id, name, archived_at, jurisdiction_ocd_id")
    .in("jurisdiction_ocd_id", [...ocdIds]);
  if (error) throw new Error(`hubs read failed: ${error.message}`);
  for (const h of (data ?? []) as Array<{ id: string; name: string; archived_at: string | null; jurisdiction_ocd_id: string }>) {
    const list = out.get(h.jurisdiction_ocd_id) ?? [];
    list.push({ id: h.id, name: h.name, archived: h.archived_at !== null });
    out.set(h.jurisdiction_ocd_id, list);
  }
  return out;
}

/** LIKE's wildcards, escaped: a name is matched as typed. */
function likeLiteral(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The type-ahead: one state's jurisdictions of one type whose name starts
 * with `q` (any word of it, so "church" finds "Falls Church city"), names
 * that start with it first. Each carries the hubs already serving it.
 */
export async function searchJurisdictions(params: {
  state: string;
  type: string;
  q: string;
  limit?: number;
}): Promise<JurisdictionMatch[]> {
  const state = params.state.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(state)) throw new ControlInputError("Choose a state.");
  if (!isReferenceJurisdictionType(params.type)) {
    throw new ControlInputError(`"${params.type}" is not a jurisdiction type. Choose one of: ${REFERENCE_JURISDICTION_TYPES.map((t) => t.id).join(", ")}.`);
  }
  const q = params.q.trim().replace(/[(),]/g, " ").replace(/\s+/g, " ").slice(0, 80);
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
  let query = getDb().from("jurisdictions").select(COLUMNS).eq("state", state).eq("type", params.type);
  if (q) {
    const lit = likeLiteral(q);
    query = query.or(`official_name.ilike.${lit}%,official_name.ilike.% ${lit}%`);
  }
  const { data, error } = await query.order("official_name", { ascending: true }).limit(q ? 200 : limit);
  if (error) throw new Error(`jurisdictions read failed: ${error.message}`);
  const rows = (data ?? []) as Jurisdiction[];
  const lower = q.toLowerCase();
  const ranked = q
    ? [...rows].sort((a, b) => Number(!a.official_name.toLowerCase().startsWith(lower)) - Number(!b.official_name.toLowerCase().startsWith(lower)))
    : rows;
  const page = ranked.slice(0, limit);
  const serving = await hubsServing(page.map((r) => r.ocd_id));
  return page.map((r) => ({ ...r, hubs: serving.get(r.ocd_id) ?? [] }));
}

// --- Slug suggestion -------------------------------------------------------------

export interface SlugSuggestion {
  slug: string | null;
  hostname: string | null;
  /** The candidates passed over, and why: shown so the operator sees the order. */
  passed_over: Array<{ slug: string; reason: string }>;
}

/** Why a slug cannot be offered, or null when it is free. */
async function slugTaken(slug: string): Promise<string | null> {
  const shape = hubSlugRejectionReason(slug);
  if (shape) return /reserved/.test(shape) ? "reserved" : "not a valid slug";
  const { data } = await getDb().from("hubs").select("id, archived_at").eq("id", slug).maybeSingle();
  if (data) return (data as { archived_at: string | null }).archived_at ? "an archived hub's" : "taken";
  const domain = platformDomain();
  if (domain && (await hostnameTakenBy(`${slug}.${domain}`))) return "its address is taken";
  return null;
}

/** The shortest free, unreserved slug for a jurisdiction (or a custom name). */
export async function suggestSlug(params: {
  name: string;
  type?: string | null;
  state?: string | null;
}): Promise<SlugSuggestion> {
  const type = isReferenceJurisdictionType(params.type) ? params.type : null;
  const state = /^[a-z]{2}$/.test(params.state ?? "") ? params.state! : null;
  const name = type ? baseName(params.name, type) : params.name;
  const passed: SlugSuggestion["passed_over"] = [];
  for (const slug of slugCandidates(name, type, state, 30)) {
    const why = await slugTaken(slug);
    if (!why) {
      const domain = platformDomain();
      return { slug, hostname: domain ? `${slug}.${domain}` : null, passed_over: passed };
    }
    passed.push({ slug, reason: why });
  }
  return { slug: null, hostname: null, passed_over: passed };
}
