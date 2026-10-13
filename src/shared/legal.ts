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
export const CURRENT_LEGAL_VERSION = "1.3";

/**
 * The newest "Last updated" line among the three documents. 1.3
 * (2026-10-14): the Privacy Notice's voting, sign-in code and session lines
 * now match ballot secrecy and the sign-in slice as built; Terms and the Code
 * of Conduct are unchanged and still say 1.2.
 */
export const CURRENT_LEGAL_LAST_UPDATED = "2026-10-14";
