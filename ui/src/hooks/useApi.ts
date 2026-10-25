/**
 * useApi — the hub app's one way to read data for a component (frontend
 * pass, 2026-10-24; ADR-013).
 *
 *   const { data, error, loading, reload, setData } =
 *     useApi(id ? `process/${id}` : null, () => getProcessState(id!));
 *
 * - `key` names what is read. Everything the fetcher depends on belongs in
 *   it: a new key is a new read, and the old one's answer is dropped. null
 *   reads nothing.
 * - A new key starts empty (`data` undefined, `loading` true), so a page
 *   never shows the previous record while the next one loads.
 * - Only the latest read for the current key lands. An answer that arrives
 *   after the key changed, after a newer reload, or after unmount is ignored,
 *   and the read is aborted (the fetcher gets the signal; pass it to
 *   request() to cancel the request itself).
 * - `reload()` reads again and keeps the current data on screen meanwhile.
 *   `setData()` replaces it in place, for an action that answers with the
 *   new record.
 * - `cache: true` keeps the answer for 30 seconds, keyed by `key` and the
 *   session token, so hopping between list pages is instant. Any write the
 *   app sends (services/http.ts `onWrite`) empties it, so your own change is
 *   never hidden. Only list pages opt in; per-reader detail reads never do.
 * - `refreshOnVisible: true` reads again when the tab comes back into view
 *   (useRefreshOnVisible).
 * - `rereadOn` (typically the signed-in actor): when it changes, read again
 *   with the current data still on screen. For a read whose answer depends on
 *   who asks (has_voted) but whose page should not blank on sign-in.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { onWrite } from "../services/http";
import { getStoredToken } from "../services/tokenStore";
import { useRefreshOnVisible } from "./useRefreshOnVisible";

// --- The short cache (moved here from services/api.ts; perf pass 2026-08-28) ---

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; data: unknown }>();
onWrite(() => cache.clear());

function cacheKeyOf(key: string): string {
  return `${key}|${getStoredToken() ?? ""}`;
}

function cached<T>(key: string): { data: T } | null {
  const hit = cache.get(cacheKeyOf(key));
  return hit && Date.now() - hit.at < CACHE_TTL_MS ? { data: hit.data as T } : null;
}

/**
 * The same cache for a read that is not a hook's (the feed's first page, which
 * pages by hand): served from the cache when fresh, else read and kept.
 */
export async function cachedRead<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = cached<T>(key);
  if (hit) return hit.data;
  const data = await fetcher();
  cache.set(cacheKeyOf(key), { at: Date.now(), data });
  return data;
}

/** Empty the cache (tests; a sign-out does not need it, the token is in the key). */
export function clearApiCache(): void {
  cache.clear();
}

// --- The hook ---------------------------------------------------------------

export interface UseApiOptions {
  /** Keep the answer 30 seconds (list pages only). */
  cache?: boolean;
  /** Read again when the tab comes back into view. */
  refreshOnVisible?: boolean;
  /** Tries again this many times, a second apart, before showing an error. */
  retries?: number;
  /** Read again, keeping the data shown, when this value changes. */
  rereadOn?: unknown;
}

export interface ApiState<T> {
  data: T | undefined;
  error: Error | null;
  /** True while the first read for this key is out and there is no data yet. */
  loading: boolean;
  reload: () => Promise<void>;
  setData: (next: T | undefined | ((prev: T | undefined) => T | undefined)) => void;
}

interface Snapshot<T> {
  key: string | null;
  data: T | undefined;
  error: Error | null;
  loading: boolean;
}

function startFor<T>(key: string | null, useCache: boolean): Snapshot<T> {
  const hit = key !== null && useCache ? cached<T>(key) : null;
  return { key, data: hit?.data, error: null, loading: key !== null && !hit };
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

const RETRY_DELAY_MS = 1000;

export function useApi<T>(
  key: string | null | undefined,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: UseApiOptions = {},
): ApiState<T> {
  const k = key ?? null;
  const useCache = options.cache === true;
  const retries = options.retries ?? 0;

  const [snap, setSnap] = useState<Snapshot<T>>(() => startFor<T>(k, useCache));
  // A new key: start over during render, so the old key's data is never
  // painted under the new one.
  let current = snap;
  if (snap.key !== k) {
    current = startFor<T>(k, useCache);
    setSnap(current);
  }

  const latestFetcher = useRef(fetcher);
  useEffect(() => {
    latestFetcher.current = fetcher;
  });

  // The read that may land: bumped by every new read, by a key change and on unmount.
  const seq = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const read = useCallback(
    async (forKey: string, triesLeft: number): Promise<void> => {
      controller.current?.abort();
      const mine = ++seq.current;
      const ctrl = new AbortController();
      controller.current = ctrl;
      let left = triesLeft;
      for (;;) {
        try {
          const data = await latestFetcher.current(ctrl.signal);
          if (seq.current !== mine) return;
          if (useCache) cache.set(cacheKeyOf(forKey), { at: Date.now(), data });
          setSnap({ key: forKey, data, error: null, loading: false });
          return;
        } catch (err) {
          if (seq.current !== mine) return;
          if (left > 0) {
            left -= 1;
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            if (seq.current !== mine) return;
            continue;
          }
          setSnap((s) => (s.key === forKey ? { ...s, error: asError(err), loading: false } : s));
          return;
        }
      }
    },
    [useCache],
  );

  useEffect(() => {
    if (k === null) return;
    if (!(useCache && cached<T>(k))) void read(k, retries);
    return () => {
      seq.current += 1;
      controller.current?.abort();
    };
  }, [k, read, useCache, retries]);

  const reload = useCallback(async () => {
    if (k === null) return;
    // "Try again" after an error: the error goes, and with nothing to show
    // the page says it is loading.
    setSnap((s) => (s.key === k && s.error ? { ...s, error: null, loading: s.data === undefined } : s));
    await read(k, 0);
  }, [k, read]);

  const setData = useCallback<ApiState<T>["setData"]>(
    (next) => {
      setSnap((s) => {
        if (s.key !== k) return s;
        const data = typeof next === "function" ? (next as (prev: T | undefined) => T | undefined)(s.data) : next;
        return { ...s, data, error: null, loading: false };
      });
    },
    [k],
  );

  useRefreshOnVisible(() => (options.refreshOnVisible ? reload() : undefined));

  const rereadOn = options.rereadOn;
  const lastRereadOn = useRef(rereadOn);
  useEffect(() => {
    if (Object.is(lastRereadOn.current, rereadOn)) return;
    lastRereadOn.current = rereadOn;
    // A cached read still fresh for this session is the answer (the cache's
    // rule: a hop within 30 seconds sends nothing).
    if (useCache && k !== null && cached<T>(k)) return;
    void reload();
  }, [rereadOn, reload, useCache, k]);

  return { data: current.data, error: current.error, loading: current.loading, reload, setData };
}
