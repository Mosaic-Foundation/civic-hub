// Central creator-display resolver.
//
// The SINGLE source of truth for turning a raw user id (e.g. "user_ab12")
// into the human-facing attribution shown next to content across the site:
// a display name plus whether that person is a hub admin.
//
// Name rule (applied EVERYWHERE — never deviate per-call-site):
//   display name = full_name ?? display_name ?? "Resident"
// We NEVER surface the raw user id and NEVER fall back to the email or an
// email-prefix. Unknown / missing / deleted ids resolve to "Resident".
//
// Admin rule:
//   is_admin = the user's email is in CIVIC_ADMIN_EMAILS (via isAdminEmail).
//
// Official rule:
//   official = users.official_type + users.official_title, when both are
//   set by an admin. ORTHOGONAL to is_admin — an account can be a hub
//   admin, a public official, both, or neither, and the byline renders a
//   pill for each half it has.
//
// Batch-first: resolveCreators() fetches every id in ONE query so list
// endpoints don't fan out into N per-row lookups. resolveCreator() is a thin
// convenience wrapper for the single-id (detail) case.
//
// AUDIENCE RULE (public anonymity, 2026-08-31):
// Every enrichment call now declares its audience. 'member' (a valid
// authenticated session) sees exactly what it always saw. 'public' (no
// valid token — the open internet, scrapers, search indexers) never
// receives a resident's real name, and the rule is CREATOR-based, the
// same on every surface:
//   - an OFFICIAL (users.official_type + official_title) keeps their real
//     name and office pill — public office is public by definition;
//   - an ADMIN (CIVIC_ADMIN_EMAILS) shows as "Admin" — the role is
//     acknowledged (an announcement, meeting summary, or word cloud is
//     institutional speech, not a resident's), but the operator's
//     personal name is never published. Reversible by design: showing
//     the name later is a one-line change here; un-publishing one from
//     scrapers is not. An admin wanting to speak purely as a neighbor
//     uses the per-comment anonymous toggle, which is never pierced.
//   - everyone else becomes "Resident" (plus a per-process number on
//     detail surfaces, via `anonNumbers`).
// The fingerprint guardrail: no stable per-user public marker for
// RESIDENTS. Numbering is per-process only (see processAnonymity.ts) —
// never global, never per-account, never a stable color or avatar.

import { getDb } from "../db/client.js";
import { isAdminEmail } from "../middleware/auth.js";
import {
  type OfficialIdentity,
  toOfficialIdentity,
} from "../shared/officialTypes.js";

export interface CreatorDisplay {
  name: string;
  is_admin: boolean;
  /**
   * The account's public office, or null for a resident. Rendered as its
   * own pill next to the name, independently of `is_admin` — someone who
   * is both shows both.
   */
  official: OfficialIdentity | null;
}

/**
 * Who is reading the response. 'member' = a valid authenticated session
 * (today's behavior, unchanged). 'public' = no valid token — resident
 * identities are redacted server-side before the payload leaves the API.
 */
export type Audience = "public" | "member";

export interface AudienceOptions {
  audience: Audience;
  /**
   * Per-process resident numbering (id → N) for detail surfaces where
   * multiple residents co-appear. Built by processAnonymity.ts. Absent on
   * cross-process list/feed surfaces, where a number would be meaningless
   * — those show plain "Resident".
   */
  anonNumbers?: Map<string, number>;
}

/** The public byline for admin-authored content (Adam, 2026-08-31). */
export const PUBLIC_ADMIN_NAME = "Admin";

/**
 * Apply the audience rule to a resolved creator. The ONLY place the
 * public/member distinction is decided — every enrichment path below
 * funnels through this.
 */
export function redactForAudience(
  creator: CreatorDisplay,
  id: string | null | undefined,
  opts: AudienceOptions,
): CreatorDisplay {
  if (opts.audience === "member") return creator;
  if (creator.official) {
    // Officials keep name + office. The Admin capability pill is still
    // never shown to the public — capability is internal, office is not.
    return { name: creator.name, is_admin: false, official: creator.official };
  }
  if (creator.is_admin) {
    // Role acknowledged, name withheld. The name IS the label, so the
    // pill (is_admin) stays off — "Admin · Admin" would be noise.
    return { name: PUBLIC_ADMIN_NAME, is_admin: false, official: null };
  }
  const n = id ? opts.anonNumbers?.get(id) : undefined;
  return {
    name: n ? `Resident ${n}` : "Resident",
    is_admin: false,
    official: null,
  };
}

/** The value used for any id we can't resolve to a real person. */
const FALLBACK: CreatorDisplay = {
  name: "Resident",
  is_admin: false,
  official: null,
};

interface UserRow {
  id: string;
  full_name: string | null;
  display_name: string | null;
  email: string | null;
  official_type?: string | null;
  official_title?: string | null;
}

/**
 * Exported for unit tests: the whole row → byline mapping, with no DB.
 *
 * Reads the official columns DEFENSIVELY (they are optional on UserRow)
 * because the surrounding query is a `select("*")` chosen specifically to
 * survive a database that has not applied a migration yet. A hub running
 * older schema resolves to `official: null` — no title — rather than
 * erroring out the content the byline annotates.
 */
export function rowToDisplay(row: UserRow): CreatorDisplay {
  const name = row.full_name?.trim() || row.display_name?.trim() || "Resident";
  return {
    name,
    is_admin: isAdminEmail(row.email),
    official: toOfficialIdentity(row.official_type, row.official_title),
  };
}

/**
 * Batch-resolve a set of user ids to their display attribution in ONE query.
 *
 * - Dedupes ids and ignores empty / falsy entries.
 * - Returns an empty map (and runs NO query) when there is nothing to resolve.
 * - Unknown / missing ids are simply absent from the map; callers should treat
 *   a miss as the "Resident" fallback (getCreator() below does this for you).
 */
export async function resolveCreators(
  ids: string[],
): Promise<Map<string, CreatorDisplay>> {
  const unique = Array.from(
    new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0)),
  );
  const map = new Map<string, CreatorDisplay>();
  if (unique.length === 0) return map;

  // select("*") rather than naming columns: creator attribution must survive
  // schema drift (e.g. a DB that hasn't applied the display_name migration).
  // Naming a missing column hard-errors; "*" returns whatever exists and
  // rowToDisplay reads name fields defensively.
  const { data, error } = await getDb()
    .from("users")
    .select("*")
    .in("id", unique);
  if (error) {
    // Attribution is a display nicety; a resolver failure must never crash the
    // content it annotates. Degrade every id to the "Resident" fallback.
    console.error(
      `[creatorDisplay] resolve failed, using Resident fallback: ${error.message}`,
    );
    return map;
  }

  for (const row of (data ?? []) as UserRow[]) {
    map.set(row.id, rowToDisplay(row));
  }
  return map;
}

/** Single-id convenience wrapper. Falls back to "Resident" on any miss. */
export async function resolveCreator(id: string): Promise<CreatorDisplay> {
  if (!id) return { ...FALLBACK };
  const map = await resolveCreators([id]);
  return map.get(id) ?? { ...FALLBACK };
}

/**
 * Read from a pre-resolved map, applying the "Resident" fallback for misses.
 * Use inside list mappers after a single resolveCreators() call.
 */
export function getCreator(
  map: Map<string, CreatorDisplay>,
  id: string | null | undefined,
): CreatorDisplay {
  if (!id) return { ...FALLBACK };
  return map.get(id) ?? { ...FALLBACK };
}

export interface EnrichOptions extends AudienceOptions {
  rawIdField?: string;
  keepRawId?: boolean;
}

/**
 * Snapshot name fields some read models carry alongside the resolved
 * creator fields (announcements stamp author_display_name at post time).
 * For a public audience these must be overridden too — a snapshot
 * bypassing the resolver is still a resident's real name in the payload.
 * Only rewritten when the model's own `official_type` is null: the
 * stamped state field is authoritative for legacy officials whose office
 * lives in hub_settings rather than on their users row.
 */
const SNAPSHOT_NAME_FIELDS = ["author_display_name", "author_name"] as const;

function applyCreatorFields(
  model: Record<string, unknown>,
  creator: CreatorDisplay,
  rawId: string,
  field: string,
  opts: EnrichOptions,
): Record<string, unknown> {
  const shown = redactForAudience(creator, rawId, opts);
  const out: Record<string, unknown> = {
    ...model,
    creator_name: shown.name,
    creator_is_admin: shown.is_admin,
    creator_official_type: shown.official?.type ?? null,
    creator_official_title: shown.official?.title ?? null,
  };
  if (
    opts.audience === "public" &&
    !creator.official &&
    (model.official_type ?? null) === null
  ) {
    for (const snap of SNAPSHOT_NAME_FIELDS) {
      if (typeof out[snap] === "string" && (out[snap] as string).length > 0) {
        out[snap] = shown.name;
      }
    }
  }
  if (!opts.keepRawId) out[field] = "";
  return out;
}

/**
 * Enrich a single read-model object with resolved creator fields and REDACT
 * the raw id from public output.
 *
 * Adds `creator_name` + `creator_is_admin`, then blanks the raw-id field named
 * by `rawIdField` (default "created_by") UNLESS `keepRawId` is true (admin /
 * moderation responses that need the id for unique identification).
 *
 * `opts.audience` is REQUIRED: every call site must declare who is reading
 * (see redactForAudience). Admin-gated endpoints pass 'member'.
 *
 * The raw id to resolve is read from `model[rawIdField]` before redaction.
 */
export async function enrichCreator(
  model: Record<string, unknown>,
  opts: EnrichOptions,
): Promise<Record<string, unknown>> {
  const field = opts.rawIdField ?? "created_by";
  const rawId = typeof model[field] === "string" ? (model[field] as string) : "";
  const creator = await resolveCreator(rawId);
  return applyCreatorFields(model, creator, rawId, field, opts);
}

/**
 * Batch variant of enrichCreator for list responses. Collects the raw ids from
 * every row, resolves them in ONE query, then maps — no per-row lookup.
 */
export async function enrichCreators(
  models: Record<string, unknown>[],
  opts: EnrichOptions,
): Promise<Record<string, unknown>[]> {
  const field = opts.rawIdField ?? "created_by";
  const ids = models
    .map((m) => (typeof m[field] === "string" ? (m[field] as string) : ""))
    .filter((id) => id.length > 0);
  const map = await resolveCreators(ids);
  return models.map((m) => {
    const rawId = typeof m[field] === "string" ? (m[field] as string) : "";
    const creator = getCreator(map, rawId);
    return applyCreatorFields(m, creator, rawId, field, opts);
  });
}
