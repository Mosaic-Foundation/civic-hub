// Slice 11 — current legal-document version.
//
// Bumped whenever any of the three documents (Privacy, Terms, Code of
// Conduct) ships a material revision. Existing users are forced
// through the re-acceptance modal on next sign-in until the value
// stored against their account matches this constant.
//
// Because the version is hardcoded (not env-var-driven), every bump
// is traceable in git history. Keep the bump in the same commit as
// the markdown changes so the version and content stay aligned.
export const CURRENT_LEGAL_VERSION = "1.1";

/**
 * Human-friendly date for the current bundle. Mirrors the "Last
 * updated" line at the top of each markdown file. The re-acceptance
 * modal can show this without parsing the markdown.
 */
export const CURRENT_LEGAL_LAST_UPDATED = "2026-08-10";
