// hub_settings reads and writes — the only place that queries that table.
//
// In src/db/ because it uses the raw service-role client, which nothing
// outside this directory and the future control plane may import.
//
// A hub's settings are loaded ONCE per request, as a whole, and cached for 60
// seconds. Loading the whole set rather than one key at a time is what lets
// the readers stay synchronous: `isAdminEmail()` is called from fourteen
// places on hot paths and cannot become async without changing all of them,
// and an admin check that does its own round trip is a round trip on every
// request that checks one.

import { getDb } from "./client.js";

const CACHE_TTL_MS = 60_000;

/** A hub's settings, as stored. Raw values — the service layer decodes. */
export type SettingsMap = Readonly<Record<string, string>>;

interface CacheEntry {
  value: SettingsMap;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Drop cached settings — for one hub, or all of them. Call after any write,
 * so an admin who changes a setting sees it on the next request rather than
 * within a minute.
 */
export function invalidateHubSettings(hubId?: string): void {
  if (hubId) cache.delete(hubId);
  else cache.clear();
}

/**
 * Every setting for one hub.
 *
 * Returns an empty map when the table cannot be read, rather than throwing.
 * Settings are configuration with fallbacks behind them: a hub that briefly
 * cannot read them should serve its env-var defaults, not a 500. The failure
 * is logged, and /health reports on the database.
 */
export async function fetchHubSettings(hubId: string): Promise<SettingsMap> {
  const cached = cache.get(hubId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { data, error } = await getDb()
    .from("hub_settings")
    .select("key, value")
    .eq("hub_id", hubId);

  if (error) {
    console.error(`[hub_settings] load for "${hubId}" failed: ${error.message}`);
    return {};
  }

  const map: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{ key: string; value: string }>) {
    map[row.key] = row.value;
  }
  cache.set(hubId, { value: map, expiresAt: Date.now() + CACHE_TTL_MS });
  return map;
}

/** Write one setting and drop the hub's cache. */
export async function writeHubSetting(
  hubId: string,
  key: string,
  value: string,
  updatedBy: string | null,
): Promise<void> {
  const { error } = await getDb()
    .from("hub_settings")
    .upsert(
      { hub_id: hubId, key, value, updated_by: updatedBy },
      { onConflict: "hub_id,key" },
    );
  if (error) throw new Error(`hubSettings.set(${key}): ${error.message}`);
  invalidateHubSettings(hubId);
}

/** Write many settings in one round trip. Used by the seed script. */
export async function writeHubSettings(
  hubId: string,
  entries: ReadonlyArray<{ key: string; value: string }>,
  updatedBy: string | null,
): Promise<void> {
  if (entries.length === 0) return;
  const rows = entries.map((e) => ({
    hub_id: hubId,
    key: e.key,
    value: e.value,
    updated_by: updatedBy,
  }));
  const { error } = await getDb()
    .from("hub_settings")
    .upsert(rows, { onConflict: "hub_id,key" });
  if (error) throw new Error(`hubSettings.setMany: ${error.message}`);
  invalidateHubSettings(hubId);
}

/** Rows as stored, with their metadata. For the admin surface. */
export async function fetchHubSettingRows(hubId: string): Promise<
  Array<{ key: string; value: string; updated_at: string; updated_by: string | null }>
> {
  const { data, error } = await getDb()
    .from("hub_settings")
    .select("key, value, updated_at, updated_by")
    .eq("hub_id", hubId);
  if (error) throw new Error(`hubSettings.getAll: ${error.message}`);
  return (data ?? []) as Array<{
    key: string;
    value: string;
    updated_at: string;
    updated_by: string | null;
  }>;
}
