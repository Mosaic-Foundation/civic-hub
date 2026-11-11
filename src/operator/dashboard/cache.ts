// A one-minute cache per server instance, for the Dashboard's reads of hubs'
// health and of the outside services (ADR-007): the page refreshes every
// minute, so each source is asked at most once a minute per instance. The
// manual refresh passes `fresh` and asks again.

export const CACHE_MS = 60_000;

const entries = new Map<string, { at: number; value: Promise<unknown> }>();

export function cached<T>(key: string, fresh: boolean, load: () => Promise<T>, ttlMs = CACHE_MS): Promise<T> {
  const hit = entries.get(key);
  if (!fresh && hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  entries.set(key, { at: Date.now(), value });
  // A failed read is not kept: the next request tries again.
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key);
  });
  return value;
}

/** Tests only. */
export function clearDashboardCache(): void {
  entries.clear();
}
