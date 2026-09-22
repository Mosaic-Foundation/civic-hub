// Hub registry reads — the only place that queries the `hubs` table.
//
// Lives in src/db/ because it uses the raw service-role client, which nothing
// outside this directory and the future control plane may import (a lint rule
// enforces that from Phase 2). `hubs` is the registry, not tenant data: it
// carries no hub_id and is never reachable through the hub-scoped client that
// Phase 2 introduces.
//
// Every request resolves through here, so the reads are cached in memory for
// 60 seconds. Serverless makes that cache per-instance and short-lived, which
// is the right trade: a hub's name or status takes up to a minute to take
// effect, and in exchange the hot path costs no round trip. The control plane
// calls invalidateHubCache() after a write so its own changes are immediate.

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

const COLUMNS =
  "id, hostname, name, jurisdiction_code, jurisdiction_name, space_did, space_type, status, created_at, updated_at";

function fresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return entry !== undefined && entry.expiresAt > Date.now();
}

function remember<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): T {
  map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/**
 * Drop every cached hub. Call after any write to `hubs` so an operator who
 * renames or suspends a hub sees it immediately rather than within a minute.
 */
export function invalidateHubCache(): void {
  byHostname.clear();
  bySlug.clear();
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

  const { data, error } = await getDb()
    .from("hubs")
    .select(COLUMNS)
    .eq("hostname", key)
    .maybeSingle();

  if (error) {
    console.error(`[hubs] lookup by hostname "${key}" failed: ${error.message}`);
    return null;
  }
  const hub = (data as Hub | null) ?? null;
  if (hub) remember(bySlug, hub.id, hub);
  return remember(byHostname, key, hub);
}

/**
 * Look a hub up by slug. Used by the local-development hostname rules and by
 * cron jobs, which have no hostname of their own.
 */
export async function getHubBySlug(slug: string): Promise<Hub | null> {
  const key = slug.trim().toLowerCase();
  const cached = bySlug.get(key);
  if (fresh(cached)) return cached.value;

  const { data, error } = await getDb()
    .from("hubs")
    .select(COLUMNS)
    .eq("id", key)
    .maybeSingle();

  if (error) {
    console.error(`[hubs] lookup by slug "${key}" failed: ${error.message}`);
    return null;
  }
  const hub = (data as Hub | null) ?? null;
  if (hub) remember(byHostname, hub.hostname, hub);
  return remember(bySlug, key, hub);
}

/**
 * Every active hub, oldest first. Phase 2's cron routes iterate this and run
 * each job once per hub; nothing else should need it.
 */
export async function listActiveHubs(): Promise<Hub[]> {
  const { data, error } = await getDb()
    .from("hubs")
    .select(COLUMNS)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`hubs.listActive: ${error.message}`);
  return (data ?? []) as Hub[];
}
