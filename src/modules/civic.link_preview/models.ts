// civic.link_preview — type definitions
//
// Service module (not a process type). Same plug-in style as civic.digest:
// pure functions with injected dependencies, no Express, no DB, no
// environment access. The host hub is responsible for caching the
// returned LinkPreview values and for serving them via an HTTP route.
//
// A hub that doesn't want link previews simply doesn't register the
// route — announcements / vote-results render plain links and nothing
// else changes. The frontend's <LinkPreviewCard> falls back to a plain
// link when the preview endpoint 404s or returns { error }.

/**
 * Result of fetching and parsing a link's OpenGraph metadata. All fields
 * except `url` and `fetched_at` are optional — a card with no `title`
 * is treated as "no preview" by the frontend and falls back to a plain
 * link.
 */
export interface LinkPreview {
  url: string;
  canonical_url: string | null;
  title: string | null;
  description: string | null;
  image_url: string | null;
  site_name: string | null;
  fetched_at: string; // ISO 8601
  /**
   * Non-null when the fetch failed. Cached with a shorter TTL so a
   * temporarily-broken URL doesn't get hammered, but successful retries
   * are still possible after the error TTL elapses.
   */
  error: string | null;
}

/**
 * Injected HTTP fetcher — abstracts node-fetch / undici / global fetch
 * so tests can stub it cleanly. Returns the response body as a string
 * along with the final URL after redirects.
 */
export interface FetchHtmlFn {
  (url: string, opts: { userAgent: string; timeoutMs: number; maxRedirects: number }): Promise<{
    finalUrl: string;
    status: number;
    contentType: string | null;
    body: string;
  }>;
}

export const FETCH_TIMEOUT_MS = 8000;
export const FETCH_MAX_REDIRECTS = 3;
export const DEFAULT_USER_AGENT =
  "Civic Hub Link Preview Bot (+https://civic.social)";

/** Cache TTLs as exposed for the host hub's controller layer. */
export const PREVIEW_TTL_SUCCESS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const PREVIEW_TTL_ERROR_MS = 60 * 60 * 1000; // 1 hour
