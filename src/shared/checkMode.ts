// How a vote's receipt check answers once the vote has closed (Actions
// slice, 2026-10-13, Adam). The voter holds the receipt (ballot secrecy,
// 2026-10-10); the hub keeps the code with the ballot, never with the voter.
//
//   show_choice:  "A ballot with this code was counted in <vote>, for
//                 <option>." The public vote log lists codes with choices.
//                 Anyone holding the code can see how that ballot was cast,
//                 so the receipt says to keep it private.
//   counted_only: "A ballot with this code was counted in <vote>." The log
//                 lists codes only. Nothing tells anyone the choice by code.
//
// The vote's creator chooses on the draft ("Show the choice" by default, or
// the hub's default for new votes); an admin can ask for a change through
// request-changes. It is fixed once the vote is approved.

export type CheckMode = "show_choice" | "counted_only";

export const CHECK_MODES: readonly CheckMode[] = ["show_choice", "counted_only"];

export const DEFAULT_CHECK_MODE: CheckMode = "show_choice";

export const CHECK_MODE_LABELS: Record<CheckMode, string> = {
  show_choice: "Show the choice",
  counted_only: "Counted only",
};

export function isCheckMode(value: unknown): value is CheckMode {
  return value === "show_choice" || value === "counted_only";
}

/** A vote's mode as stored; a vote from before modes shows the choice, as its log always did. */
export function checkModeOf(state: unknown): CheckMode {
  const v = (state as Record<string, unknown> | null)?.check_mode;
  return isCheckMode(v) ? v : DEFAULT_CHECK_MODE;
}
