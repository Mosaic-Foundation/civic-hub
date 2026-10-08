// The super admin's configuration: which hostname it answers on, and the one
// person allowed to sign in. Both are environment values, never literals in
// code (Adam, 2026-09-26): production is console.civic.social, dev
// console.dev.civic.social (since 2026-09-27; console-civic-hub-dev.vercel.app
// before, still routed), local console.localhost. vercel.json's console
// rules must name each one; tests/unit/consoleRouting.test.ts checks.
//
//   CIVIC_CONSOLE_HOSTNAME     the console's hostname. Unset = no console on
//                              this deployment: every request goes to the hub
//                              app, exactly as before.
//   CIVIC_CONSOLE_ADMIN_EMAIL  the one address that may sign in. Exactly one;
//                              a list is refused rather than half-honoured.
//
// See BUILD-PLAN-multi-tenant.md → Phase 5 → "The super admin, as decided".

import { normalizeHostname } from "../middleware/hub.js";

export function consoleHostname(): string | null {
  const raw = process.env.CIVIC_CONSOLE_HOSTNAME?.trim();
  return raw ? normalizeHostname(raw) : null;
}

/** Did this request arrive on the console hostname? False when there is none. */
export function isConsoleHost(hostHeader: string | undefined | null): boolean {
  const host = consoleHostname();
  return host !== null && normalizeHostname(hostHeader) === host;
}

/**
 * The domain hubs live under, taken from the console's own hostname:
 * console.civic.social → civic.social. A new hub may not take a reserved
 * name under it (www.civic.social, polis.civic.social…). Null when the
 * console hostname has no parent worth reserving under.
 */
export function platformDomain(): string | null {
  const host = consoleHostname();
  if (!host) return null;
  const dot = host.indexOf(".");
  const parent = dot >= 0 ? host.slice(dot + 1) : "";
  return parent.includes(".") ? parent : null;
}

export type AdminEmailConfig =
  | { ok: true; email: string }
  | { ok: false; problem: string };

export function consoleAdminEmail(): AdminEmailConfig {
  const raw = process.env.CIVIC_CONSOLE_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  if (!raw) return { ok: false, problem: "CIVIC_CONSOLE_ADMIN_EMAIL is not set." };
  if (/[,;\s]/.test(raw)) {
    return { ok: false, problem: "CIVIC_CONSOLE_ADMIN_EMAIL must name exactly one address." };
  }
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(raw)) {
    return { ok: false, problem: "CIVIC_CONSOLE_ADMIN_EMAIL is not an email address." };
  }
  return { ok: true, email: raw };
}

/**
 * Production Supabase hosts. Creating a hub there is what the MEETING_* /
 * FLOYD_NEWS_* guard protects (./hubs.ts). Same list as the seed guard in
 * src/controllers/debugController.ts.
 */
const PRODUCTION_SUPABASE_HOSTS: readonly string[] = [
  "nfhyypwoporfggqcerli.supabase.co", // Civic-Hub-Floyd — production
];

export function isProductionDatabase(): boolean {
  const raw = process.env.SUPABASE_URL?.trim();
  if (!raw) return false;
  try {
    return PRODUCTION_SUPABASE_HOSTS.includes(new URL(raw).hostname.toLowerCase());
  } catch {
    return false;
  }
}

// --- The start page (session 4b, 2026-10-08) ---------------------------------
//
//   CIVIC_START_HOSTNAME  where a person with an invite code creates their own
//                         hub: start.civic.social in production,
//                         start.dev.civic.social on dev, start.localhost
//                         locally. Unset = no start page on this deployment
//                         (Adam: production stays unset until he opens it).
//                         vercel.json's start rules must name each one;
//                         tests/unit/consoleRouting.test.ts checks.

export function startHostname(): string | null {
  const raw = process.env.CIVIC_START_HOSTNAME?.trim();
  return raw ? normalizeHostname(raw) : null;
}

/** Did this request arrive on the start page's hostname? False when there is none. */
export function isStartHost(hostHeader: string | undefined | null): boolean {
  const host = startHostname();
  return host !== null && normalizeHostname(hostHeader) === host;
}

/**
 * The domain a hub made on the start page lives under: the start page's own
 * parent. start.civic.social → civic.social, start.dev.civic.social →
 * dev.civic.social, start.localhost → localhost. Null with no start page.
 */
export function startHubDomain(): string | null {
  const host = startHostname();
  if (!host) return null;
  const dot = host.indexOf(".");
  const parent = dot >= 0 ? host.slice(dot + 1) : "";
  return parent || null;
}
