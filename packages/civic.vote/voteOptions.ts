// The limit on a vote option's length (Actions slice, 2026-10-13, from
// Adam's Oct 10 walk: long options wrapped to five or six lines in the
// results). Enforced when a vote is made (a draft's submit, an admin's
// create); votes made before it keep their options as written.

export const VOTE_OPTION_MAX = 80;

/**
 * The options as a vote gets them: each trimmed, blank ones dropped. An
 * empty field left by "+ Add option" is ignored, never refused (Adam,
 * 2026-10-13); a vote still needs two that aren't blank.
 */
export function filledOptions(options: readonly unknown[]): string[] {
  return options.filter((o): o is string => typeof o === "string").map((o) => o.trim()).filter(Boolean);
}

/** The first option longer than the limit, or null. */
export function overlongOption(options: readonly unknown[]): string | null {
  for (const o of options) if (typeof o === "string" && o.trim().length > VOTE_OPTION_MAX) return o;
  return null;
}
