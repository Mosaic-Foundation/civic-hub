// A hub — one row of the tenant registry.
//
// Contract: BUILD-PLAN-multi-tenant.md → "Contracts / 1. hubs table".
// Created by supabase/migrations/20260922010000_hubs.sql.

export interface Hub {
  /**
   * The slug, e.g. "floyd". Also the value stamped into every other table's
   * hub_id from Phase 2 on.
   *
   * NOT the protocol identity carried on published activities as
   * `source.hub_id` — that is CIVIC_HUB_ID (`HUB_ID` in config/hub.ts) and is
   * a separate, unrelated identifier. Do not substitute one for the other.
   */
  id: string;
  /** Lowercase host the resolver matches on. No scheme, no port. */
  hostname: string;
  name: string;
  /** Civic place code, or null when this hub has no civic geography. */
  jurisdiction_code: string | null;
  jurisdiction_name: string | null;
  /** The space's stable identifier: generator.id on emitted activities. */
  space_did: string;
  space_type: string;
  status: HubStatus;
  created_at: string;
  updated_at: string;
}

export type HubStatus = "active" | "suspended";

/**
 * Slugs no hub may ever be assigned: hostnames the platform itself needs, or
 * ones that would read as the platform rather than as a hub.
 *
 * Enforced twice on purpose — here, so a caller gets a readable error, and as
 * a CHECK constraint on `hubs`, so no code path can get around it. Keep the
 * two lists identical; the constraint is in the migration above.
 */
export const RESERVED_HUB_SLUGS: readonly string[] = [
  "www",
  "admin",
  "api",
  "polis",
  "representative",
  "demo",
  "staging",
  "dev",
  "mail",
  "app",
];

/** Mirrors the hubs_id_format_check constraint. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

export function isReservedHubSlug(slug: string): boolean {
  return RESERVED_HUB_SLUGS.includes(slug.trim().toLowerCase());
}

/**
 * Is this string shaped like a hub slug? Shape only — says nothing about
 * whether a hub with that slug exists.
 */
export function isWellFormedHubSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/**
 * Can this slug be assigned to a new hub? Returns null when it can, or the
 * reason it cannot, phrased for an operator rather than for a log.
 */
export function hubSlugRejectionReason(slug: string): string | null {
  const trimmed = slug.trim();
  if (!isWellFormedHubSlug(trimmed)) {
    return (
      `"${slug}" is not a valid hub slug. Use 2 to 32 characters, lowercase ` +
      `letters, digits and hyphens, not starting or ending with a hyphen.`
    );
  }
  if (isReservedHubSlug(trimmed)) {
    return `"${trimmed}" is reserved and cannot be assigned to a hub.`;
  }
  return null;
}
