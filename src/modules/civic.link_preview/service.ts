// civic.link_preview — service: orchestrates fetch + parse.
//
// Pure of side effects beyond what the injected `fetchHtml` callback
// performs. The host hub owns: HTTP routing, the DB cache, the rate
// limiter, and the user-agent override. This service only knows how
// to turn a URL into a LinkPreview.

import { CivicError } from "../../errors/index.js";
import { parseHtmlToPreview } from "./scraper.js";
import type { FetchHtmlFn, LinkPreview } from "./models.js";
import {
  DEFAULT_USER_AGENT,
  FETCH_MAX_REDIRECTS,
  FETCH_TIMEOUT_MS,
} from "./models.js";

/**
 * Quick gate against malformed and dangerous URLs before we bother
 * fetching. Returns the normalized URL on success, or an error string.
 */
export function validatePreviewUrl(input: string): { url: string } | { error: string } {
  if (typeof input !== "string" || input.trim().length === 0) {
    return { error: "Missing url parameter." };
  }
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return { error: "Malformed URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "Only http:// and https:// URLs are supported." };
  }
  // Reject obvious internal targets to prevent SSRF-flavored abuse.
  // Production hub sits behind HTTPS, so an http://localhost target
  // from an untrusted form is never legitimate.
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host) || // link-local / cloud metadata
    /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./.test(host) // CGNAT 100.64/10
  ) {
    return { error: "Internal hosts are not allowed." };
  }
  // Note: this is only a fast string gate. The fetcher (linkPreviewFetcher.ts)
  // runs the authoritative check — it resolves the host to its real IP and
  // re-validates every redirect hop via assertPublicUrl().
  return { url: parsed.toString() };
}

export interface FetchPreviewDeps {
  fetchHtml: FetchHtmlFn;
  userAgent?: string;
  timeoutMs?: number;
  maxRedirects?: number;
  now?: () => Date;
}

/**
 * Fetch + parse a single URL. On HTTP errors / non-HTML responses /
 * timeouts, returns a LinkPreview with `error` set and other fields
 * null — callers cache that too (with a shorter TTL) so a broken URL
 * isn't refetched on every render.
 */
export async function fetchLinkPreview(
  inputUrl: string,
  deps: FetchPreviewDeps,
): Promise<LinkPreview> {
  const validation = validatePreviewUrl(inputUrl);
  if ("error" in validation) {
    return errorPreview(inputUrl, validation.error, deps);
  }
  const url = validation.url;
  const userAgent = deps.userAgent ?? DEFAULT_USER_AGENT;
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxRedirects = deps.maxRedirects ?? FETCH_MAX_REDIRECTS;

  try {
    const res = await deps.fetchHtml(url, { userAgent, timeoutMs, maxRedirects });
    if (res.status < 200 || res.status >= 300) {
      return errorPreview(url, `Upstream returned HTTP ${res.status}`, deps);
    }
    const ct = (res.contentType || "").toLowerCase();
    if (ct && !ct.includes("text/html") && !ct.includes("application/xhtml")) {
      return errorPreview(url, `Unsupported content-type: ${ct}`, deps);
    }
    const parsed = parseHtmlToPreview(res.body, res.finalUrl || url);
    return {
      url,
      canonical_url: parsed.canonical_url,
      title: parsed.title,
      description: parsed.description,
      image_url: parsed.image_url,
      site_name: parsed.site_name,
      fetched_at: nowIso(deps),
      error: null,
    };
  } catch (err) {
    // A refusal of the address (blocked, unresolvable, too large) is plain
    // text meant for a person; anything else is the network's own wording and
    // stays in the log.
    if (!(err instanceof CivicError)) console.warn(`[link_preview] fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    const message = err instanceof CivicError ? err.message : "Couldn't fetch this link.";
    return errorPreview(url, message, deps);
  }
}

function errorPreview(
  url: string,
  message: string,
  deps: FetchPreviewDeps,
): LinkPreview {
  return {
    url,
    canonical_url: null,
    title: null,
    description: null,
    image_url: null,
    site_name: null,
    fetched_at: nowIso(deps),
    error: message,
  };
}

function nowIso(deps: FetchPreviewDeps): string {
  return (deps.now?.() ?? new Date()).toISOString();
}

/**
 * URL-extraction helper used by the host hub when an announcement /
 * vote-results record is saved. Pulls every distinct http(s) URL from
 * a free-text body. Exported so callers don't have to replicate the
 * regex.
 */
export function extractUrls(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const matches = text.match(/\bhttps?:\/\/\S+/gi) ?? [];
  const cleaned = matches
    .map((raw) => raw.replace(/[)\].,;!?]+$/, "")) // strip trailing punctuation
    .filter((u) => u.length > 0);
  return Array.from(new Set(cleaned));
}
