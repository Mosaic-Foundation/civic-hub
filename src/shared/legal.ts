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
export const CURRENT_LEGAL_VERSION = "1.4";

/**
 * Versions whose acceptance still counts, because every revision since was
 * non-material (Adam's decision, 2026-10-17). 1.4 only renames where to opt
 * out of the digest and close an account ("Your settings") and drops a line
 * from the draft notes, so whoever accepted 1.3 isn't asked again. A material
 * revision empties this list, and everyone is asked, as for 1.3.
 */
export const LEGAL_VERSIONS_NOT_REQUIRING_REACCEPTANCE: readonly string[] = ["1.3"];

/** Has someone who accepted `stored` agreed to the documents as they stand? */
export function legalAcceptanceIsCurrent(stored: string | null | undefined): boolean {
  if (stored == null) return false;
  return stored === CURRENT_LEGAL_VERSION || LEGAL_VERSIONS_NOT_REQUIRING_REACCEPTANCE.includes(stored);
}

/**
 * The newest "Last updated" line among the three documents. 1.4
 * (2026-10-17): Privacy and Terms name Your settings; the Code of Conduct is
 * unchanged and still says 1.2.
 */
export const CURRENT_LEGAL_LAST_UPDATED = "2026-10-17";
