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
   * `source.hub_id` — that is `protocol_hub_id` below, a separate,
   * unrelated identifier. Do not substitute one for the other.
   */
  id: string;
  /**
   * `source.hub_id` on every event this hub publishes. Floyd's is
   * 'civic-hub-local', the identity its published events already carry; a
   * new hub's is 'civic-hub-<slug>', written once by scripts/create-hub.ts
   * and never recomputed from `id`.
   */
  protocol_hub_id: string;
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
  /**
   * Lifecycle state. Null means "not configured", and the reader falls back
   * to the environment variables — which is what keeps an unseeded
   * deployment behaving exactly as it did.
   */
  mode: HubMode | null;
  created_at: string;
  updated_at: string;
}

export type HubStatus = "active" | "suspended";

/**
 * The hub the migrations create first, and the column default they stamp on
 * `hub_id` (hub_settings and sessions today, every table in Phase 2).
 *
 * Code names it here and nowhere else, and only where the database already
 * assumes it: the slug a bare `localhost` resolves to when CIVIC_DEV_HUB is
 * unset, and the hub a session is minted on when no hub is in scope — the
 * value the column default would have supplied anyway. It goes when Phase 2
 * drops the column defaults. Allow-listed in scripts/place-name-allowlist.txt.
 */
export const MIGRATION_DEFAULT_HUB_ID = "floyd";

/**
 * Where a hub is in its life. One ordered state, not a set of flags: demo and
 * beta are contradictory (demo lets anyone in with any code, beta lets only
 * allowlisted people in), so a hub must be in exactly one of them.
 *
 *   demo  open to anyone, no real email verification, demo banner
 *   beta  real verification, allowlist gate, waitlist form, beta banner
 *   live  real verification, open to anyone, no banner
 *
 * `status` is the other axis and answers a different question: whether the
 * hub is serving at all.
 */
export type HubMode = "demo" | "beta" | "live";

export const HUB_MODES: readonly HubMode[] = ["demo", "beta", "live"];

export function isHubMode(value: unknown): value is HubMode {
  return typeof value === "string" && (HUB_MODES as readonly string[]).includes(value);
}

/**
 * Modes a hub's own admin may choose (decided with Adam, 2026-09-22).
 *
 * `demo` is NOT among them. It is settable only by the control plane or a
 * seed script, never from the hub admin UI, because it is the one mode that
 * turns off email verification: a hub admin who selected it — by accident, or
 * because their account was taken — would drop the door open on a real
 * jurisdiction's hub and let anyone sign in as anyone. Moving between beta
 * and live is an ordinary operator decision; entering demo is a decision
 * about what a hub IS, and belongs with whoever creates hubs.
 *
 * The restriction is one-directional (clarified with Adam, 2026-09-22). A hub
 * created in demo stays in demo until ITS OWN ADMIN moves it to beta or live
 * — that is a real hub graduating, and the admin is the right person to say
 * when. What no admin may do is move a hub INTO demo. Only the control plane
 * can do that, when the hub is created.
 */
export const ADMIN_SETTABLE_HUB_MODES: readonly HubMode[] = ["beta", "live"];

export function isAdminSettableHubMode(value: unknown): value is HubMode {
  return (
    typeof value === "string" &&
    (ADMIN_SETTABLE_HUB_MODES as readonly string[]).includes(value)
  );
}

/**
 * May a hub admin move this hub from `from` to `to`? Returns null when they
 * may, or the reason they may not, phrased for the person reading the form.
 */
export function hubModeChangeRejectionReason(
  _from: HubMode,
  to: unknown,
): string | null {
  if (!isHubMode(to)) {
    return `"${String(to)}" is not a hub mode. Choose one of: ${HUB_MODES.join(", ")}.`;
  }
  if (!isAdminSettableHubMode(to)) {
    return "Demo mode can only be set by the platform operator, not from hub settings.";
  }
  // Moving OUT of demo is allowed: a demo hub graduating to beta or live is a
  // real decision, and its own admin is the right person to make it. Only the
  // direction INTO demo is reserved.
  return null;
}

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
