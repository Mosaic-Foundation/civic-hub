// StatusFilter — the shared status filter bar for process list pages
// (2026-08-28). Votes had one; Adam wants it on every list page, with
// only the statuses relevant to that page as choices. One component so
// the four pages can't drift in style or URL behavior.
//
// State is mirrored in the URL as `?status=<key>` (missing = "all"), so
// a filtered view is bookmarkable and survives refresh — same contract
// the Votes page established. Styling reuses the .votes-filter classes
// in kit/patterns.css (Events 3).

import type { StatusFilterChoice } from "./statusFilterState";
import { FilterBar } from "../kit";

interface Props {
  choices: ReadonlyArray<StatusFilterChoice>;
  active: string;
  onChange: (next: string) => void;
  /** Accessible name, e.g. "Filter conversations by status". */
  label: string;
}

/** The kit's FilterBar (Events 3), with the hub's status choices. */
export default function StatusFilter({ choices, active, onChange, label }: Props) {
  return <FilterBar choices={choices} active={active} onChange={onChange} label={label} />;
}
