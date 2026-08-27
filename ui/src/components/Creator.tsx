// Creator — the single, consistent way to render a content creator/author
// across the site. Renders the resolved display name (never a raw user id)
// with an optional prefix ("by", "Proposed by", "Created by", "Posted by")
// and the badges that belong to that person.
//
// Two badges, independent of one another:
//   - the OFFICE pill  ("Board of Supervisors") — a public identity an
//     admin designated on that account
//   - the "Admin" pill — a platform capability (CIVIC_ADMIN_EMAILS)
// Someone who is both a hub admin and a sitting supervisor shows BOTH.
// They are never merged and never substitute for one another.
//
// The badge decision itself lives in the shared, dependency-free
// authorBadges() so it can be unit-tested without a DOM (the repo has no
// frontend test runner) — this component is a thin map over it, the same
// split as feedActivity.ts.
//
// Always feed this the RESOLVED name from the API (creator_name /
// author_name), which the backend guarantees is full_name ?? display_name
// ?? "Resident" — never a raw id or email.

import { authorBadges } from "../../../src/shared/officialTypes";
import "./Creator.css";

interface CreatorProps {
  /** Resolved display name (already falls back to "Resident" server-side). */
  name: string;
  /** Show the "Admin" pill when true. */
  isAdmin?: boolean;
  /**
   * The author's office, from creator_official_type / creator_official_title
   * (or author_official_* on comments). Both null for residents. The TITLE
   * is what renders; the TYPE only selects the pill's colour class.
   */
  officialType?: string | null;
  officialTitle?: string | null;
  /** Optional lead-in, e.g. "by", "Proposed by", "Created by", "Posted by". */
  prefix?: string;
}

export default function Creator({
  name,
  isAdmin,
  officialType,
  officialTitle,
  prefix,
}: CreatorProps) {
  const display = name && name.trim().length > 0 ? name : "Resident";
  const badges = authorBadges({ isAdmin, officialType, officialTitle });
  return (
    <span className="creator">
      {prefix ? `${prefix} ` : null}
      <span className="creator-name">{display}</span>
      {badges.map((badge) => (
        <span key={badge.kind} className={badge.className}>
          {badge.text}
        </span>
      ))}
    </span>
  );
}
