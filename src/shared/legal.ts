// The current legal-document version (Slice 11), shared by the server and
// the hub UI since the sign-in slice (2026-10-14): the start page records a
// hub creator's agreement on the server, at creation, so the creator isn't
// asked again as a member.
//
// Bumped whenever any of the three documents (Privacy, Terms, Code of
// Conduct) ships a revision. Existing users are shown the re-acceptance notice
// on next sign-in until the value stored against their account is this
// constant, or one of the versions below that a non-material revision
// replaced. Keep the bump in the same commit as the markdown changes so the
// version and content stay aligned.
export const CURRENT_LEGAL_VERSION = "1.5";

/**
 * Versions whose acceptance still counts, because every revision since was
 * non-material. A material revision empties this list, and everyone is asked.
 *
 * Empty since 1.5 (Adam, 2026-11-17): the Privacy Policy now says that a
 * ballot carries the voter's district and age group, and that someone with a
 * copy of the database could work out how a person voted if they were the
 * only voter in their group. That changes a promise, so everyone accepts
 * again. (Before: ["1.3"], because 1.4 only renamed "Your settings".)
 */
export const LEGAL_VERSIONS_NOT_REQUIRING_REACCEPTANCE: readonly string[] = [];

/** Has someone who accepted `stored` agreed to the documents as they stand? */
export function legalAcceptanceIsCurrent(stored: string | null | undefined): boolean {
  if (stored == null) return false;
  return stored === CURRENT_LEGAL_VERSION || LEGAL_VERSIONS_NOT_REQUIRING_REACCEPTANCE.includes(stored);
}

/**
 * The newest "Last updated" line among the three documents. 1.5
 * (2026-11-17): the Privacy Policy's About you and ballot tags; both it and
 * the Terms now say a change is shown on the next visit and accepted before
 * going on (no email promised), so the Terms are 1.5 too. The Code of
 * Conduct stays 1.2.
 */
export const CURRENT_LEGAL_LAST_UPDATED = "2026-11-17";
