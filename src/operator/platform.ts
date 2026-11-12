// What the hub deployment knows about the platform it runs on, for the
// operator API (./api.ts): the domain hubs live under, whose reserved names no
// hub may take, and whether this is the production database.

import { env } from "../config/env.js";

/**
 * The domain hubs live under (civic.social): CIVIC_PLATFORM_DOMAIN. A new hub
 * may not take a reserved name under it (www.civic.social, polis.civic.social,
 * start.civic.social…). Null when unset (local development).
 */
export function platformDomain(): string | null {
  return env.CIVIC_PLATFORM_DOMAIN?.trim().toLowerCase() || null;
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
