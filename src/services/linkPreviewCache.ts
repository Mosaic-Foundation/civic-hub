// Slice 9 — DB-backed cache for link previews.
//
// Reads/writes the `link_previews` table created by
// migrations/20260427100000_post_images_and_link_previews.sql. The
// civic.link_preview module is responsible for the actual fetch +
// parse; this file is just the storage adapter.
//
// Cache policy:
//   - successful preview: 7 day TTL
//   - failed preview (error column non-null): 1 hour TTL
//   - readers may serve stale-while-revalidate; for MVP we re-fetch
//     synchronously on cache miss / staleness and write through.

import { getDb } from "../db/client.js";
import {
  fetchLinkPreview,
  PREVIEW_TTL_ERROR_MS,
  PREVIEW_TTL_SUCCESS_MS,
  type LinkPreview,
} from "../modules/civic.link_preview/index.js";
import { fetchHtmlForPreview } from "./linkPreviewFetcher.js";

interface CacheRow {
  url: string;
  canonical_url: string | null;
  title: string | null;
  description: string | null;
  image_url: string | null;
  site_name: string | null;
  fetched_at: string;
  error: string | null;
}

function rowToPreview(row: CacheRow): LinkPreview {
  return {
    url: row.url,
    canonical_url: row.canonical_url,
    title: row.title,
    description: row.description,
    image_url: row.image_url,
    site_name: row.site_name,
    fetched_at: row.fetched_at,
    error: row.error,
  };
}

function isStale(row: CacheRow, now: number): boolean {
  const fetchedAt = new Date(row.fetched_at).getTime();
  if (!Number.isFinite(fetchedAt)) return true;
  const age = now - fetchedAt;
  const ttl = row.error ? PREVIEW_TTL_ERROR_MS : PREVIEW_TTL_SUCCESS_MS;
  return age >= ttl;
}

export async function readCachedPreview(url: string): Promise<LinkPreview | null> {
  const { data, error } = await getDb()
    .from("link_previews")
    .select("*")
    .eq("url", url)
    .maybeSingle();
  if (error) {
    // Table missing or transient — treat as cache miss; the caller
    // will re-fetch and try to write through (which will also no-op
    // if the table really is missing).
    return null;
  }
  if (!data) return null;
  return rowToPreview(data as CacheRow);
}

export async function writeCachedPreview(preview: LinkPreview): Promise<void> {
  const row: CacheRow = {
    url: preview.url,
    canonical_url: preview.canonical_url,
    title: preview.title,
    description: preview.description,
    image_url: preview.image_url,
    site_name: preview.site_name,
    fetched_at: preview.fetched_at,
    error: preview.error,
  };
  const { error } = await getDb()
    .from("link_previews")
    .upsert(row, { onConflict: "url" });
  if (error) {
    // Don't throw — preview rendering must never block on cache write.
    console.warn(
      `[link_preview] cache write failed for ${preview.url}: ${error.message}`,
    );
  }
}

/**
 * Public surface: return a fresh preview for the URL, using the cache
 * when possible. Always returns a LinkPreview (with `error` set when
 * the upstream is broken) so callers can render uniformly.
 */
export async function getOrRefreshPreview(url: string): Promise<LinkPreview> {
  const now = Date.now();
  const cached = await readCachedPreview(url);
  if (cached && !isStale(cached, now)) return cached;

  const userAgent =
    process.env.LINK_PREVIEW_USER_AGENT ||
    "Civic Hub Link Preview Bot (+https://civic.social)";

  const fresh = await fetchLinkPreview(url, {
    fetchHtml: fetchHtmlForPreview,
    userAgent,
  });
  await writeCachedPreview(fresh);
  return fresh;
}

/**
 * Fire-and-forget warm. Used by the announcement / vote-results save
 * paths to pre-cache OG previews so the public page renders instantly
 * on first view. Errors are logged but never thrown — preview warming
 * is best-effort.
 */
export function warmPreviewsInBackground(urls: string[]): void {
  for (const url of urls) {
    getOrRefreshPreview(url).catch((err) => {
      console.warn(
        `[link_preview] background warm failed for ${url}:`,
        err instanceof Error ? err.message : err,
      );
    });
  }
}
