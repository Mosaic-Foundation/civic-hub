// What the hub deployment knows about the platform it runs on, for the
// operator API (./api.ts): the domain hubs live under, the hostnames no hub
// may take, and whether this is the production database.
//
// Before the console split these were read from the console's own hostname
// (src/control/config.ts). The hub may not import the console, so they live
// here; CIVIC_PLATFORM_DOMAIN says the domain outright, which it must once the
// console moves to console.mosaic.social (whose parent is not where hubs live).

import { env } from "../config/env.js";
import { normalizeHostname } from "../middleware/hub.js";

/** Hostnames of the platform's own pages on this deployment (the console, the start page): never a hub's. */
export function platformHostnames(): string[] {
  return [env.CIVIC_CONSOLE_HOSTNAME, env.CIVIC_START_HOSTNAME]
    .map((h) => h?.trim())
    .filter((h): h is string => Boolean(h))
    .map((h) => normalizeHostname(h));
}

/**
 * The domain hubs live under (civic.social). A new hub may not take a
 * reserved name under it (www.civic.social, polis.civic.social…).
 * CIVIC_PLATFORM_DOMAIN when set; otherwise the console hostname's parent
 * (console.civic.social → civic.social). Null when neither gives one.
 */
export function platformDomain(): string | null {
  const explicit = env.CIVIC_PLATFORM_DOMAIN?.trim().toLowerCase();
  if (explicit) return explicit;
  const raw = env.CIVIC_CONSOLE_HOSTNAME?.trim();
  if (!raw) return null;
  const host = normalizeHostname(raw);
  const dot = host.indexOf(".");
  const parent = dot >= 0 ? host.slice(dot + 1) : "";
  return parent.includes(".") ? parent : null;
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
  const raw = env.SUPABASE_URL?.trim();
  if (!raw) return false;
  try {
    return PRODUCTION_SUPABASE_HOSTS.includes(new URL(raw).hostname.toLowerCase());
  } catch {
    return false;
  }
}
