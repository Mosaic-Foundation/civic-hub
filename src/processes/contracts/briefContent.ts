// The brief contract: what a process type's generateBrief returns (the
// type-agnostic content of a Civic Brief). Here, in the process contract, so
// the handler interface (src/processes/types.ts) depends on no plugin;
// packages/civic.brief stores and publishes it and re-exports these types
// (Architecture 2, 2026-10-21).

/**
 * One structured block of a brief. Type-specific detail lives here:
 * conversation → opinion clusters / common ground; proposal → support
 * breakdown; project → milestones; vote (later) → position breakdown.
 */
export interface BriefSection {
  heading: string;
  body: string;
}

/**
 * The generic, type-agnostic content of a brief. A process handler's
 * `generateBrief` produces this; admin can edit `comments` / `admin_notes`
 * / image during review (the rest is a frozen snapshot of the outcome).
 */
export interface BriefContent {
  /** The source process's title. */
  title: string;
  /** One-line outcome, e.g. "Community reached broad agreement" or
   *  "Advanced to a vote" or "Project completed". */
  headline: string;
  /** Main readable body of the outcome. */
  summary: string;
  /** Type-specific structured detail (may be empty). */
  sections: BriefSection[];
  /** Human label for participation, e.g. "42 participants",
   *  "18 endorsements". Null when not applicable. */
  participation_label: string | null;
  participation_count: number | null;
  /** Resident voices surfaced alongside the outcome; admin-editable. */
  comments: string[];
  admin_notes: string;
  /** Optional featured image (public Supabase Storage URL). */
  image_url?: string | null;
  image_alt?: string | null;
  /**
   * The source was closed before its deadline (Close early): the line the
   * brief shows, and the admin's note, verbatim. Set when the brief is made.
   */
  closed_early?: { line: string; note: string } | null;
}
