// The limit on a vote option's length (Actions slice, 2026-10-13, from
// Adam's Oct 10 walk: long options wrapped to five or six lines in the
// results). Enforced when a vote is made (a draft's submit, an admin's
// create); votes made before it keep their options as written.

export const VOTE_OPTION_MAX = 80;

/** The first option longer than the limit, or null. */
export function overlongOption(options: readonly unknown[]): string | null {
  for (const o of options) if (typeof o === "string" && o.trim().length > VOTE_OPTION_MAX) return o;
  return null;
}
