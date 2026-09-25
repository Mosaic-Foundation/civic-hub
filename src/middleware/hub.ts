// Hub resolver — turns the request's hostname into the hub that serves it.
//
// This is the seam that makes one deployment serve many hubs. It runs before
// anything that reads or writes data, so by the time a route handler is
// reached, `req.hub` is set and a hub-scoped view of the world is available.
// A request whose hostname belongs to no hub never reaches a handler at all.
//
// Contract: BUILD-PLAN-multi-tenant.md → "Contracts / 4. Request flow".
//
// Resolution order:
//   1. Exact hostname match against `hubs.hostname`.
//   2. Local development only: a `?hub=<slug>` query override.
//   3. Local development only: `<slug>.localhost` -> that slug, and a bare
//      `localhost` -> the slug in CIVIC_DEV_HUB (default "floyd").
//
// Rules 2 and 3 exist so two hubs can be exercised against one dev server
// without editing /etc/hosts or running two processes. They are switched off
// entirely in production: a query parameter that can change which tenant's
// data you see would be a cross-tenant hole, not a convenience.

import type { NextFunction, Request, Response } from "express";
import { getHubByHostname, getHubBySlug } from "../db/hubs.js";
import { fetchHubSettings } from "../db/hubSettingsStore.js";
import { runWithHub } from "../config/hubContext.js";
import {
  isWellFormedHubSlug,
  MIGRATION_DEFAULT_HUB_ID,
  type Hub,
} from "../models/hub.js";

declare global {
  namespace Express {
    interface Request {
      /**
       * The hub serving this request. Set by resolveHub for every request
       * that reaches a route handler; undefined only on the exempt paths
       * below, which are deployment-wide rather than per-hub.
       */
      hub?: Hub;
    }
  }
}

/**
 * Paths that belong to the deployment, not to any one hub, and so must answer
 * even on a hostname no hub claims.
 *
 * - /health is what uptime monitoring and the platform itself hit; making it
 *   depend on a hub would mean a misconfigured hostname reads as "the service
 *   is down" instead of "that hostname has no hub".
 * - /internal/* is the cron surface. Scheduled invocations arrive on the
 *   deployment's own hostname with no hub context; Phase 2 converts these to
 *   iterate hubs explicitly, at which point the exemption becomes the point
 *   rather than a workaround.
 */
function isHubExempt(path: string): boolean {
  return path === "/health" || path === "/internal" || path.startsWith("/internal/");
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Host header -> comparable hostname: lowercased, port removed, trailing dot
 * removed. IPv6 literals keep their brackets, which is how they are written
 * in a Host header and how they would have to be stored to match.
 */
export function normalizeHostname(raw: string | undefined | null): string {
  const host = (raw ?? "").trim().toLowerCase();
  if (!host) return "";
  if (host.startsWith("[")) {
    // [::1]:3000 -> [::1]
    const close = host.indexOf("]");
    return close === -1 ? host : host.slice(0, close + 1);
  }
  const colon = host.indexOf(":");
  const withoutPort = colon === -1 ? host : host.slice(0, colon);
  return withoutPort.replace(/\.$/, "");
}

/** Hostnames that mean "this developer's machine". */
export function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

/**
 * The hub slug a local hostname implies, or null when it implies none.
 *
 * `athens.localhost` -> "athens". A bare `localhost` returns null, and the
 * caller falls back to CIVIC_DEV_HUB. Multi-label names like
 * `a.b.localhost` return null rather than guessing which label is the slug.
 */
export function devHubSlugFromHostname(hostname: string): string | null {
  if (!hostname.endsWith(".localhost")) return null;
  const label = hostname.slice(0, -".localhost".length);
  if (!label || label.includes(".")) return null;
  return isWellFormedHubSlug(label) ? label : null;
}

/** The slug a bare localhost resolves to. */
export function devDefaultHubSlug(): string {
  const configured = process.env.CIVIC_DEV_HUB?.trim().toLowerCase();
  return configured && isWellFormedHubSlug(configured)
    ? configured
    : MIGRATION_DEFAULT_HUB_ID;
}

/**
 * Should this response be JSON rather than HTML?
 *
 * The path cannot be used to decide. In production every API request is
 * rewritten through /api and the prefix is stripped before Express sees it,
 * so a browser navigation and an API call arrive looking identical. The
 * Accept header does distinguish them: a browser asks for text/html
 * explicitly, while fetch() sends the wildcard and so takes the first type
 * offered, which is why json is listed first.
 */
export function prefersJson(req: Request): boolean {
  return req.accepts(["json", "html"]) !== "html";
}

const PAGE_STYLE =
  "font: 16px/1.6 system-ui, -apple-system, Segoe UI, sans-serif;" +
  "max-width: 34rem; margin: 18vh auto; padding: 0 1.5rem; color: #1a1a1a;";

/**
 * The two dead-end pages. Deliberately plain: no hub name, no branding, no
 * data, nothing read from the database. A request that resolved to no hub has
 * no hub whose identity could legitimately appear on the page, and rendering
 * one hub's branding on another's hostname is how tenancy leaks start.
 */
function deadEndPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title></head>
<body style="${PAGE_STYLE}">
<h1 style="font-size:1.35rem;margin:0 0 .5rem">${title}</h1>
<p style="margin:0;color:#555">${body}</p>
</body></html>`;
}

function sendNoHub(req: Request, res: Response): void {
  if (prefersJson(req)) {
    res.status(404).json({ error: "no_hub" });
    return;
  }
  res
    .status(404)
    .type("html")
    .send(
      deadEndPage(
        "No hub here",
        "No civic hub is configured at this address. Check the link you followed.",
      ),
    );
}

function sendHubPaused(req: Request, res: Response): void {
  if (prefersJson(req)) {
    res.status(503).json({ error: "hub_suspended" });
    return;
  }
  res
    .status(503)
    .type("html")
    .send(
      deadEndPage(
        "This hub is paused",
        "This civic hub is temporarily unavailable. Please check back later.",
      ),
    );
}

/** Resolve without deciding what to do about the result. Exported for tests. */
export async function resolveHubForHostname(
  hostname: string,
  queryHub?: string,
): Promise<Hub | null> {
  const direct = await getHubByHostname(hostname);
  if (direct) return direct;

  // Development-only fallbacks, never reachable in production.
  if (isProduction() || !isLocalHostname(hostname)) return null;

  if (queryHub && isWellFormedHubSlug(queryHub)) {
    const overridden = await getHubBySlug(queryHub);
    if (overridden) return overridden;
  }

  const slug = devHubSlugFromHostname(hostname) ?? devDefaultHubSlug();
  return getHubBySlug(slug);
}

/**
 * Express middleware. Registered once, before every route and before any
 * body parsing or seeding, so nothing can run against an unresolved hub.
 */
export async function resolveHub(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (isHubExempt(req.path)) {
    next();
    return;
  }

  const hostname = normalizeHostname(req.headers.host ?? req.hostname);
  const queryHub =
    typeof req.query?.hub === "string" ? req.query.hub.toLowerCase() : undefined;

  let hub: Hub | null;
  try {
    hub = await resolveHubForHostname(hostname, queryHub);
  } catch (e) {
    // A registry read that throws is an outage, not an unknown hostname.
    // Say so rather than telling the caller their address is wrong.
    console.error(
      `[hub] resolver failed for "${hostname}": ${e instanceof Error ? e.message : String(e)}`,
    );
    res.status(503).json({ error: "hub_registry_unavailable" });
    return;
  }

  if (!hub) {
    sendNoHub(req, res);
    return;
  }
  if (hub.status === "suspended") {
    // 503, not 404: the hub exists and is coming back. A 404 would tell
    // crawlers and clients to forget it.
    sendHubPaused(req, res);
    return;
  }

  // Load the hub's settings once, here, and carry them with the hub for the
  // rest of the request. Loading them per read would put a round trip inside
  // isAdminEmail(), which runs on paths served to every visitor; loading them
  // here is what lets those readers stay synchronous.
  const settings = await fetchHubSettings(hub.id);

  req.hub = hub;
  runWithHub(hub, settings, () => next());
}
