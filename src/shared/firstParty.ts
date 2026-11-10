// What counts as a first-party plugin package (console slice, ADR-015
// amendment): one built from packages/ in this repository, named in the
// @civic-social/ scope. `catalog:add` refuses an outside folder that claims
// the scope, so a release may approve and sign a first-party entry CI proved
// green; every other entry waits for the operator's approval in the console.
//
// Shared by the server and the scripts. Pure.

export const FIRST_PARTY_SCOPE = "@civic-social/";

export function isFirstPartyName(name: string): boolean {
  return name.startsWith(FIRST_PARTY_SCOPE);
}

/** The approved_by a release writes: `release@<commit>` (a 7 to 40 hex commit). */
export const RELEASE_APPROVER = /^release@([0-9a-f]{7,40})$/;

export function releaseApprover(commit: string): string {
  return `release@${commit}`;
}

/** The commit a release approval names, or null when a person approved it. */
export function releaseCommitOf(approvedBy: string | null | undefined): string | null {
  return approvedBy ? (RELEASE_APPROVER.exec(approvedBy)?.[1] ?? null) : null;
}
