/**
 * The hub's legal and policy documents, fetched when a page needs one.
 *
 * These used to be compiled into the bundle with Vite's `?raw`, which baked
 * one hub's text into the build — the thing this phase exists to undo. They
 * are also around 30 KB between them and are rendered by three pages, so they
 * are deliberately NOT part of the boot config: a visitor looking at the feed
 * should not download the terms of service to get there.
 *
 * The bundled copies remain as the fallback. A hub that cannot be reached
 * shows the text it always showed rather than an empty page, and a single-hub
 * self-host with no rows behaves exactly as before.
 */

const API_BASE = import.meta.env.DEV ? "http://localhost:3000" : "/api";

export type DocumentKey =
  | "legal.terms"
  | "legal.privacy"
  | "legal.code_of_conduct"
  | "legal.proposal_best_practices"
  | "copy.about";

let cache: Record<string, string> | null = null;
let inFlight: Promise<Record<string, string>> | null = null;

/** Mirrors the dev-only hub forwarding in hubConfig.ts. */
function devHubQuery(): string {
  if (!import.meta.env.DEV || typeof window === "undefined") return "";
  const fromQuery = new URLSearchParams(window.location.search).get("hub");
  const host = window.location.hostname;
  const fromHost = host.endsWith(".localhost")
    ? host.slice(0, -".localhost".length)
    : null;
  const slug = fromQuery ?? fromHost;
  return slug && /^[a-z0-9-]+$/.test(slug) ? `?hub=${encodeURIComponent(slug)}` : "";
}

/**
 * Fetch every document once and remember them. Never rejects: a failure
 * returns an empty map and each caller falls back to its bundled copy.
 */
export function loadHubDocuments(): Promise<Record<string, string>> {
  if (cache) return Promise.resolve(cache);
  if (inFlight) return inFlight;

  inFlight = fetch(`${API_BASE}/hub-config/documents${devHubQuery()}`, {
    headers: { Accept: "application/json" },
  })
    .then((res) => (res.ok ? res.json() : { documents: {} }))
    .then((body: { documents?: Record<string, string> }) => {
      cache = body.documents ?? {};
      return cache;
    })
    .catch(() => {
      cache = {};
      return cache;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** The loaded document, or undefined before the fetch resolves. */
export function loadedDocument(key: DocumentKey): string | undefined {
  const value = cache?.[key];
  return value === undefined || value === "" ? undefined : value;
}
