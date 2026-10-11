// hub_settings reads and writes — the only place that queries that table.
//
// Reads and writes go through forHub(hubId), so a settings row can only be
// read from, or written to, the hub it names (Phase 2a).
//
// A hub's settings are loaded ONCE per request, as a whole, and cached for 60
// seconds. Loading the whole set rather than one key at a time is what lets
// the readers stay synchronous: `isAdminEmail()` is called from fourteen
// places on hot paths and cannot become async without changing all of them,
// and an admin check that does its own round trip is a round trip on every
// request that checks one.

import { forHub } from "./forHub.js";
import { DOCUMENT_KEYS } from "../models/hubSettings.js";

const CACHE_TTL_MS = 60_000;

/** A hub's settings, as stored. Raw values — the service layer decodes. */
export type SettingsMap = Readonly<Record<string, string>>;

interface CacheEntry {
  value: SettingsMap;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Documents are cached separately, keyed `<hubId>:<key>`. */
const documentCache = new Map<string, { value: string | null; expiresAt: number }>();

/** PostgREST `in` list for the document keys, so the snapshot can exclude them. */
const DOCUMENT_KEY_LIST = `(${DOCUMENT_KEYS.join(",")})`;

/**
 * Drop cached settings — for one hub, or all of them. Call after any write,
 * so an admin who changes a setting sees it on the next request rather than
 * within a minute.
 */
export function invalidateHubSettings(hubId?: string): void {
  if (hubId) {
    cache.delete(hubId);
    for (const k of documentCache.keys()) {
      if (k.startsWith(`${hubId}:`)) documentCache.delete(k);
    }
  } else {
    cache.clear();
    documentCache.clear();
  }
}

/** A hub's settings could not be read. The hub answers 503 until they can. */
export class HubSettingsUnavailableError extends Error {
  constructor(hubId: string, cause: string) {
    super(`Settings for hub "${hubId}" could not be read: ${cause}`);
    this.name = "HubSettingsUnavailableError";
  }
}

/**
 * Every setting for one hub.
 *
 * Throws HubSettingsUnavailableError when the table cannot be read. It used
 * to return an empty map, and every key then fell back to the server's env:
 * the hub's admin roster became CIVIC_ADMIN_EMAILS for that request. A hub
 * that cannot read its settings does not know who its people are, so it
 * says it is unavailable (the hub resolver's 503) rather than guess. Nothing
 * is cached on failure, so the next request tries again.
 */
export async function fetchHubSettings(hubId: string): Promise<SettingsMap> {
  const cached = cache.get(hubId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  // Document-sized values are excluded: see DOCUMENT_KEYS. Every request pays
  // for this query on a cache miss, and no request should pay 30 KB of
  // markdown for a page that does not render it.
  let rows: Array<{ key: string; value: string }>;
  try {
    rows = await forHub(hubId)
      .from("hub_settings")
      .select<{ key: string; value: string }>("key, value")
      .not("key", "in", DOCUMENT_KEY_LIST);
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[hub_settings] load for "${hubId}" failed: ${message}`);
    throw new HubSettingsUnavailableError(hubId, message);
  }

  const map: Record<string, string> = {};
  for (const row of rows) {
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
  await forHub(hubId)
    .from("hub_settings")
    .upsert({ key, value, updated_by: updatedBy }, { onConflict: "hub_id,key" });
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
    key: e.key,
    value: e.value,
    updated_by: updatedBy,
  }));
  await forHub(hubId).from("hub_settings").upsert(rows, { onConflict: "hub_id,key" });
  invalidateHubSettings(hubId);
}

/** Rows as stored, with their metadata. For the admin surface. */
export async function fetchHubSettingRows(hubId: string): Promise<
  Array<{ key: string; value: string; updated_at: string; updated_by: string | null }>
> {
  return forHub(hubId)
    .from("hub_settings")
    .select<{ key: string; value: string; updated_at: string; updated_by: string | null }>(
      "key, value, updated_at, updated_by",
    );
}

/**
 * One document-sized value — a legal page, the About text.
 *
 * Separate from the snapshot on purpose (see DOCUMENT_KEYS): loaded only when
 * something renders it, cached for the same 60 seconds, and a miss returns
 * null rather than throwing so a page falls back to its bundled default
 * instead of failing.
 */
export async function fetchHubDocument(
  hubId: string,
  key: string,
): Promise<string | null> {
  const cacheKey = `${hubId}:${key}`;
  const cached = documentCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: string | null;
  try {
    const row = await forHub(hubId)
      .from("hub_settings")
      .select<{ value: string }>("value")
      .eq("key", key)
      .maybeSingle();
    value = row?.value ?? null;
  } catch (err) {
    console.error(
      `[hub_settings] document "${key}" for "${hubId}" failed: ${(err as Error).message}`,
    );
    return null;
  }
  documentCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Every document for a hub, for the endpoint that serves them together. */
export async function fetchHubDocuments(
  hubId: string,
): Promise<Record<string, string>> {
  let rows: Array<{ key: string; value: string }>;
  try {
    rows = await forHub(hubId)
      .from("hub_settings")
      .select<{ key: string; value: string }>("key, value")
      .in("key", [...DOCUMENT_KEYS]);
  } catch (err) {
    console.error(
      `[hub_settings] documents for "${hubId}" failed: ${(err as Error).message}`,
    );
    return {};
  }
  const out: Record<string, string> = {};
  for (const row of rows) {
    out[row.key] = row.value;
  }
  return out;
}
