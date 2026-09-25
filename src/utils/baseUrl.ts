// The hub's public URLs.
//
// Two origins:
//
// - baseUrl() — the API origin: `source.hub_url` on events (federation
//   partners federate against it), `/.well-known/civic.json`, the AS2
//   collection ids.
// - uiBaseUrl() — the UI origin: `action_url` on events (Civic Event Spec §3:
//   a human-reachable page, not a REST endpoint), every link in an email.
//
// PER HUB SINCE PHASE 2c. One deployment serves many hubs, so the origin is
// the hub in scope's own `hubs.hostname`, never one env var for everybody —
// before this, Athens's events carried Floyd's host. With a hub in scope:
//
//   - https://<hostname>, the production case, where the UI and the API are
//     one origin (Vercel rewrites /api to the function);
//   - outside production, for a local hostname (athens.localhost), the dev
//     scheme the resolver serves it on: http, with the port taken from
//     BASE_URL (API) or CIVIC_UI_BASE_URL (UI) when those name a local host —
//     the split-origin dev setup, API on :3000 and UI on :5173.
//
// BASE_URL and CIVIC_UI_BASE_URL are otherwise only the fallback for code
// with no hub in scope (boot, a script outside withHubScope).
//
// Both strip trailing slashes so callers can write `${baseUrl()}/events`.

import { currentHub } from "../config/hubContext.js";
import { isLocalHostname } from "../models/hub.js";

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function envApiBase(): string {
  return stripTrailingSlash(process.env.BASE_URL ?? "http://localhost:3000");
}

function envUiBase(): string {
  return stripTrailingSlash(
    process.env.CIVIC_UI_BASE_URL ?? process.env.BASE_URL ?? "http://localhost:3000",
  );
}

/**
 * A hub's origin from its hostname. `devTemplate` is the env origin whose
 * port a local hostname borrows outside production.
 */
export function hubOrigin(hostname: string, devTemplate: string): string {
  const host = hostname.trim().toLowerCase();
  if (process.env.NODE_ENV !== "production" && isLocalHostname(host)) {
    let port = "";
    try {
      const t = new URL(devTemplate);
      if (isLocalHostname(t.hostname) && t.port) port = `:${t.port}`;
    } catch {
      // A malformed env value: no port rather than a wrong one.
    }
    return `http://${host}${port}`;
  }
  return `https://${host}`;
}

export function baseUrl(): string {
  const hub = currentHub();
  return hub ? hubOrigin(hub.hostname, envApiBase()) : envApiBase();
}

/**
 * The origin UI pages are served from, for `action_url` on events and links
 * in email, so a resident clicking through lands on a page, not JSON.
 */
export function uiBaseUrl(): string {
  const hub = currentHub();
  return hub ? hubOrigin(hub.hostname, envUiBase()) : envUiBase();
}
