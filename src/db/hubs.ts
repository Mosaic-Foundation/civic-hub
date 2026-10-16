// @civic-raw-client-importer: the hubs registry has no hub_id and is read before any hub is known.
// The hub registry — the only place that queries the `hubs` table.
//
// Lives in src/db/ because it uses the raw service-role client, which nothing
// outside this directory and the future control plane may import (a lint rule
// enforces that from Phase 2). `hubs` is the registry, not tenant data: it
// carries no hub_id and is never reachable through the hub-scoped client that
// Phase 2 introduces.
//
// Every request resolves through here. A hub that is found is read fresh on
// every request (one indexed query): its row carries `settings_version`,
// which every change to the hub's settings or to the row bumps (migration
// 20261018000000), and the settings cache compares it with its own copy. So a
// save, a mode switch or a rename reaches every server instance on its next
// request, not within a minute.
//
// Only misses are cached, for 60 seconds, so an unknown hostname (a scanner, a
// misdirected request) stays cheap. The control plane calls
// invalidateHubCache() after creating or moving a hub, so its own instance
// sees the new hostname at once.

import { getDb } from "./client.js";
import type { Hub } from "../models/hub.js";

const CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** Keyed by hostname. A miss is cached too, so an unknown host is cheap. */
const byHostname = new Map<string, CacheEntry<Hub | null>>();
const bySlug = new Map<string, CacheEntry<Hub | null>>();
/** Keyed by an address a hub has moved from. Misses cached too: this runs only after a hostname miss. */
const byPreviousHostname = new Map<string, CacheEntry<Hub | null>>();

const BASE_COLUMNS =
  "id, protocol_hub_id, hostname, name, jurisdiction_code, jurisdiction_name, space_did, space_type, status, mode, created_at, updated_at, redirect_to";

/**
 * Off once a read finds no `settings_version` column: code deployed ahead of
 * migration 20261018000000 then still resolves every hub (its settings cache
 * goes by the 60-second expiry), and /health names the gap.
 */
let versionColumn = true;

type HubsRead = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Run a `hubs` read, falling back to the columns before the version column. */
async function readHubs(build: (columns: string) => HubsRead): Promise<{ data: unknown; error: { message: string } | null }> {
  const first = await build(versionColumn ? `${BASE_COLUMNS}, settings_version` : BASE_COLUMNS);
  if (first.error && versionColumn && first.error.message.includes("settings_version")) {
    versionColumn = false;
    console.error("[hubs] no settings_version column; run migration 20261018000000");
    return build(BASE_COLUMNS);
  }
  return first;
}

/** A cached miss still in date. Found hubs are never cached: see the header. */
function fresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return entry !== undefined && entry.expiresAt > Date.now();
}

function remember<T>(map: Map<string, CacheEntry<T | null>>, key: string, value: T | null): T | null {
  if (value === null) map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  else map.delete(key);
  return value;
}

/**
 * Drop every cached miss. Call after creating a hub or changing a hostname,
 * so this instance finds the new address at once. (Other changes need no
 * call: a found hub is read fresh on every request.)
 */
export function invalidateHubCache(): void {
  byHostname.clear();
  bySlug.clear();
  byPreviousHostname.clear();
}

/**
 * Look a hub up by hostname. Returns null when no hub serves that host —
 * including when the table itself is unreachable, which the caller renders as
 * "no hub here" rather than as a 500. That is deliberate: an unknown host is
 * overwhelmingly a misdirected request, not an outage, and /health is the
 * surface that reports on the database.
 */
export async function getHubByHostname(hostname: string): Promise<Hub | null> {
  const key = hostname.trim().toLowerCase();
  const cached = byHostname.get(key);
  if (fresh(cached)) return cached.value;

  const { data, error } = await readHubs((columns) =>
    getDb().from("hubs").select(columns).eq("hostname", key).maybeSingle(),
  );

  if (error) {
    console.error(`[hubs] lookup by hostname "${key}" failed: ${error.message}`);
    return null;
  }
  return remember(byHostname, key, (data as Hub | null) ?? null);
}

/**
 * The hub that used to answer on this hostname and has moved (review R47):
 * `hubs.previous_hostnames` contains it. Null when none did, or when the read
 * fails — including on a database without the column yet, where the
 * resolver then answers "no hub here" exactly as it did before.
 */
export async function getHubByPreviousHostname(hostname: string): Promise<Hub | null> {
  const key = hostname.trim().toLowerCase();
  const cached = byPreviousHostname.get(key);
  if (fresh(cached)) return cached.value;

  const { data, error } = await readHubs((columns) =>
    getDb().from("hubs").select(columns).contains("previous_hostnames", [key]).limit(1),
  );

  if (error) {
    console.error(`[hubs] lookup by previous hostname "${key}" failed: ${error.message}`);
    return null;
  }
  const hub = ((data ?? []) as Hub[])[0] ?? null;
  return remember(byPreviousHostname, key, hub);
}

/**
 * Look a hub up by slug. Used by the local-development hostname rules and by
 * cron jobs, which have no hostname of their own.
 */
export async function getHubBySlug(slug: string): Promise<Hub | null> {
  const key = slug.trim().toLowerCase();
  const cached = bySlug.get(key);
  if (fresh(cached)) return cached.value;

  const { data, error } = await readHubs((columns) =>
    getDb().from("hubs").select(columns).eq("id", key).maybeSingle(),
  );

  if (error) {
    console.error(`[hubs] lookup by slug "${key}" failed: ${error.message}`);
    return null;
  }
  return remember(bySlug, key, (data as Hub | null) ?? null);
}

/**
 * Every active hub, oldest first. Phase 2's cron routes iterate this and run
 * each job once per hub; nothing else should need it.
 */
export async function listActiveHubs(): Promise<Hub[]> {
  const { data, error } = await readHubs((columns) =>
    getDb().from("hubs").select(columns).eq("status", "active").order("created_at", { ascending: true }),
  );

  if (error) throw new Error(`hubs.listActive: ${error.message}`);
  return (data ?? []) as Hub[];
}

/**
 * Set a hub's lifecycle mode. The one registry write a hub's own admin can
 * make (through POST /admin/hub/mode, after the step-up code); the rules on
 * which moves are allowed live in hubModeChangeRejectionReason(), and a
 * trigger refuses any move INTO demo whatever the caller. Throws with the
 * database's message on failure; the cache is dropped on success.
 */
export async function setHubMode(hubId: string, mode: string): Promise<void> {
  const { error } = await getDb().from("hubs").update({ mode }).eq("id", hubId);
  if (error) throw new Error(error.message);
  invalidateHubCache();
}

/**
 * Rename a hub in the registry: the one other registry write a hub's own
 * admin makes, when their new hub name replaces a registry name that still
 * matched the old one (review R11, src/controllers/hubSettingsController.ts).
 */
export async function renameHub(hubId: string, name: string): Promise<void> {
  const { error } = await getDb().from("hubs").update({ name }).eq("id", hubId);
  if (error) throw new Error(error.message);
  invalidateHubCache();
}

/**
 * A hub's settings version, read fresh (20261018000000). For settings reads
 * outside a request for that hub (crons, the console, scripts), which have no
 * freshly read row to take it from. Null when it can't be read, and the
 * settings cache then falls back to its 60-second expiry. Never throws: a
 * settings read must not fail on the version alone.
 */
export async function getHubSettingsVersion(hubId: string): Promise<number | null> {
  if (!versionColumn) return null;
  let data: unknown;
  try {
    const read = await getDb().from("hubs").select("settings_version").eq("id", hubId).maybeSingle();
    if (read.error) return null;
    data = read.data;
  } catch {
    return null;
  }
  if (!data) return null;
  const v = (data as { settings_version?: unknown }).settings_version;
  return typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null;
}
