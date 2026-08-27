// officialTypes.ts — THE shared vocabulary for admin-designated officials.
//
// An "official" is an account an admin has marked as holding a public
// office. It has two parts:
//   official_type   a coarse machine-readable kind — drives the pill's
//                   colour and any future per-office filtering
//   official_title  the human string actually rendered ("Board of
//                   Supervisors", "Supervisor, District 3")
// Type is stored; TITLE is what renders. Two people can share a type and
// show different titles.
//
// SHARED ACROSS BOTH RUNTIMES — consumed by:
//   - the Node backend (auth middleware, creatorDisplay, admin settings)
//   - the Vite frontend (Creator, AdminSettings)
// It MUST therefore stay framework-agnostic and DEPENDENCY-FREE (no
// imports), exactly like feedActivity.ts. Frontend imports it by relative
// path; the backend gets it via `src/**/*`.
//
// ADDING AN OFFICE TYPE is three edits, none of which touch a component:
//   1. the union + OFFICIAL_TYPES below
//   2. OFFICIAL_TYPE_LABELS (the admin-panel dropdown text)
//   3. the CHECK constraint in supabase/migrations/*_official_role.sql
// A per-type pill colour is then a single CSS rule on
// `.creator-official-badge--<kebab-type>` — no TypeScript change at all.

/** Coarse office kind. Mirrors the users_official_type_chk CHECK. */
export type OfficialType =
  | "board_of_supervisors"
  | "town_council"
  | "planning_commission"
  | "school_board"
  | "other";

/** Ordered for the admin panel's <select>. */
export const OFFICIAL_TYPES: OfficialType[] = [
  "board_of_supervisors",
  "town_council",
  "planning_commission",
  "school_board",
  "other",
];

/** Admin-facing names. NOT what renders publicly — that is official_title. */
export const OFFICIAL_TYPE_LABELS: Record<OfficialType, string> = {
  board_of_supervisors: "Board of Supervisors",
  town_council: "Town Council",
  planning_commission: "Planning Commission",
  school_board: "School Board",
  other: "Other",
};

/**
 * The fallback type for anything we cannot place — a legacy free-form
 * label, an unrecognized value from a DB that is ahead of this build.
 * Never throws: an unknown type must degrade to a rendered pill, not to
 * a missing one.
 */
export const DEFAULT_OFFICIAL_TYPE: OfficialType = "other";

/** Narrow an unknown value to an OfficialType, or null when absent. */
export function normalizeOfficialType(raw: unknown): OfficialType | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return (OFFICIAL_TYPES as string[]).includes(trimmed)
    ? (trimmed as OfficialType)
    : DEFAULT_OFFICIAL_TYPE;
}

/**
 * CSS class suffix for a type — kebab-cased so the stylesheet reads
 * `.creator-official-badge--board-of-supervisors`. Unknown types fall
 * back to the default suffix rather than emitting an unstyled class.
 */
export function officialPillKind(type: unknown): string {
  const normalized = normalizeOfficialType(type) ?? DEFAULT_OFFICIAL_TYPE;
  return normalized.replace(/_/g, "-");
}

/**
 * Best-effort type for a free-form legacy label. Used when seeding the
 * managed role from hub_settings.announcement_authors and when falling
 * back to CIVIC_BOARD_EMAILS — neither carries a type. Deliberately
 * conservative: anything unrecognized becomes "other", which renders
 * identically and can be corrected in the admin panel.
 */
export function inferOfficialType(label: unknown): OfficialType {
  if (typeof label !== "string") return DEFAULT_OFFICIAL_TYPE;
  const l = label.toLowerCase();
  if (l.includes("supervisor") || l.includes("board member")) {
    return "board_of_supervisors";
  }
  if (l.includes("council")) return "town_council";
  if (l.includes("planning")) return "planning_commission";
  if (l.includes("school")) return "school_board";
  return DEFAULT_OFFICIAL_TYPE;
}

/** An official identity attached to an account. */
export interface OfficialIdentity {
  type: OfficialType;
  title: string;
}

/**
 * Build an OfficialIdentity from loose parts, or null when there is no
 * title to render. The title is the load-bearing half: a type with no
 * title is not an official as far as any surface is concerned.
 */
export function toOfficialIdentity(
  type: unknown,
  title: unknown,
): OfficialIdentity | null {
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  if (cleanTitle.length === 0) return null;
  return {
    type: normalizeOfficialType(type) ?? DEFAULT_OFFICIAL_TYPE,
    title: cleanTitle,
  };
}

/** One rendered badge next to an author's name. */
export interface AuthorBadge {
  kind: "official" | "admin";
  /** Visible pill text. */
  text: string;
  /** Full className string for the <span>. */
  className: string;
}

/**
 * THE badge decision for an author byline — the single source of truth
 * for what pills appear next to a name and in what order.
 *
 * Order is office first, platform role second: the office is who this
 * person IS in the community; "Admin" is what they can do in this
 * software. Someone who is both an admin and a Board member gets BOTH
 * pills, never a merged one.
 *
 * Pure and dependency-free so it is unit-testable without a DOM — the
 * repo has no frontend test infrastructure, and the Creator component is
 * a thin map over this function precisely so the logic can be covered in
 * tests/unit (the same split as feedActivity.ts).
 */
export function authorBadges(input: {
  isAdmin?: boolean | null;
  officialType?: unknown;
  officialTitle?: unknown;
}): AuthorBadge[] {
  const badges: AuthorBadge[] = [];
  const official = toOfficialIdentity(input.officialType, input.officialTitle);
  if (official) {
    badges.push({
      kind: "official",
      text: official.title,
      className: `creator-official-badge creator-official-badge--${officialPillKind(official.type)}`,
    });
  }
  if (input.isAdmin) {
    badges.push({
      kind: "admin",
      text: "Admin",
      className: "creator-admin-badge",
    });
  }
  return badges;
}
