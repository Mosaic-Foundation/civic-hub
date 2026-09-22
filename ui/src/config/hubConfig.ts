/**
 * The hub's configuration, fetched from the API at boot.
 *
 * WHY THIS EXISTS. Hub identity used to be compiled into the bundle from
 * VITE_HUB_* variables, so serving a second hub meant a second build with a
 * second set of variables. One deployment now serves many hubs, and which one
 * you are looking at is decided by the hostname at request time — something a
 * build-time constant cannot express. This module fetches that identity once,
 * before React renders, and everything else reads it from here.
 *
 * The VITE_HUB_* variables are kept as fallbacks, not removed: a single-hub
 * self-hosted deployment that never creates a hubs row still works exactly as
 * it did, and they are what renders if the fetch fails.
 *
 * Contract: BUILD-PLAN-multi-tenant.md → "Contracts / 2. hub_settings" for
 * the key names, "4. Request flow" item 5 for the response shape.
 */

export interface HubIdentity {
  id: string;
  name: string;
  hostname: string;
  jurisdiction_code: string | null;
  jurisdiction_name: string | null;
  space_did: string;
}

export interface HubConfig {
  hub: HubIdentity;
  /** Dotted keys — see the build plan's public subset. */
  settings: Record<string, string>;
}

const API_BASE = import.meta.env.DEV ? "http://localhost:3000" : "/api";

/**
 * How long to wait for the config before rendering with build-time fallbacks.
 * A hub that cannot answer in two seconds should show the operator's
 * configured defaults rather than a blank page.
 */
const LOAD_TIMEOUT_MS = 2000;

let loaded: HubConfig | null = null;

/**
 * In local development the UI runs on :5173 and calls the API on :3000
 * directly, so the API sees its own hostname rather than the one in the
 * address bar and would always resolve the same hub. This forwards the hub
 * the page is being viewed as, using the API's development-only `?hub=`
 * override, so athens.localhost:5173 shows Athens.
 *
 * Production returns an empty string: there the UI and API share an origin,
 * the hostname is the only thing that selects a hub, and the override does
 * not exist server-side at all.
 *
 * Phase 2, when data becomes hub-scoped, should replace this with a Vite dev
 * proxy that forwards /api to :3000 with the original Host intact. That makes
 * every call hub-correct in development, not just this one.
 */
function devHubQuery(): string {
  if (!import.meta.env.DEV || typeof window === "undefined") return "";
  const fromQuery = new URLSearchParams(window.location.search).get("hub");
  const host = window.location.hostname;
  const fromHost = host.endsWith(".localhost")
    ? host.slice(0, -".localhost".length)
    : null;
  const slug = fromQuery ?? fromHost;
  return slug && /^[a-z0-9-]+$/.test(slug)
    ? `?hub=${encodeURIComponent(slug)}`
    : "";
}

/** The fetched config, or null before load() has resolved. */
export function getLoadedHubConfig(): HubConfig | null {
  return loaded;
}

/** A single settings value, or undefined when the hub has not configured it. */
export function setting(key: string): string | undefined {
  const v = loaded?.settings[key];
  return v === undefined || v === "" ? undefined : v;
}

/**
 * Fetch the config for whichever hub is serving this hostname.
 *
 * Never throws and never rejects. A hub that cannot be reached is a reason to
 * render with fallbacks, not a reason to show nothing: the alternative is a
 * white screen for a transient network failure.
 */
export async function loadHubConfig(): Promise<HubConfig | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/hub-config${devHubQuery()}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as HubConfig;
    if (!body?.hub?.id) return null;
    loaded = body;
    return loaded;
  } catch {
    // Offline, aborted, or a hostname with no hub. Fallbacks it is.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Apply the hub's identity to the document head.
 *
 * index.html carries the build-time %VITE_HUB_PAGE_TITLE% substitutions, which
 * are correct for the deployment's primary hub and wrong for every other one.
 * Rewriting them here fixes the tab title and the share tags for anyone
 * running a browser. Crawlers that do not execute JavaScript still see the
 * built-in values on the bare "/" route; every routed detail page is served by
 * api/og.ts, which resolves them per hostname server-side.
 */
export function applyHubHead(): void {
  if (typeof document === "undefined" || !loaded) return;

  const title = setting("identity.page_title") ?? loaded.hub.name;
  const description = setting("identity.description") ?? setting("identity.tagline");
  const image = setting("identity.banner_url");
  const imageAlt = setting("identity.banner_alt");

  document.title = title;
  setMeta("name", "description", description);
  setMeta("property", "og:title", title);
  setMeta("property", "og:description", description);
  setMeta("property", "og:image", image);
  setMeta("property", "og:image:alt", imageAlt);
  setMeta("property", "og:site_name", loaded.hub.name);
}

function setMeta(
  attr: "name" | "property",
  key: string,
  value: string | undefined,
): void {
  if (!value) return;
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", value);
}
