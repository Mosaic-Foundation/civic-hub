// The current legal-document version (Slice 11), shared by the server and
// the hub UI since the sign-in slice (2026-10-14): the start page records a
// hub creator's agreement on the server, at creation, so the creator isn't
// asked again as a member.
//
// Bumped whenever any of the three documents (Privacy, Terms, Code of
// Conduct) ships a material revision. Existing users are shown the
// re-acceptance notice on next sign-in until the value stored against their
// account matches this constant. Keep the bump in the same commit as the
// markdown changes so the version and content stay aligned.
export const CURRENT_LEGAL_VERSION = "1.2";

/** Mirrors the "Last updated" line at the top of each markdown file. */
export const CURRENT_LEGAL_LAST_UPDATED = "2026-09-07";
