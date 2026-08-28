// StatusFilter — the shared status filter bar for process list pages
// (2026-08-28). Votes had one; Adam wants it on every list page, with
// only the statuses relevant to that page as choices. One component so
// the four pages can't drift in style or URL behavior.
//
// State is mirrored in the URL as `?status=<key>` (missing = "all"), so
// a filtered view is bookmarkable and survives refresh — same contract
// the Votes page established. Styling reuses the .votes-filter classes
// in App.css.

import { useSearchParams } from "react-router-dom";

export interface StatusFilterChoice {
  key: string;
  label: string;
}

/** Read/write the ?status= param, constrained to the page's choices. */
export function useStatusFilter(choices: ReadonlyArray<StatusFilterChoice>): {
  active: string;
  setActive: (next: string) => void;
} {
  const [params, setParams] = useSearchParams();
  const raw = params.get("status");
  const active =
    raw && choices.some((c) => c.key === raw && c.key !== "all") ? raw : "all";

  function setActive(next: string) {
    const updated = new URLSearchParams(params);
    if (next === "all") updated.delete("status");
    else updated.set("status", next);
    // `replace` keeps the back button focused on cross-page navigation,
    // not a stack of filter changes.
    setParams(updated, { replace: true });
  }

  return { active, setActive };
}

interface Props {
  choices: ReadonlyArray<StatusFilterChoice>;
  active: string;
  onChange: (next: string) => void;
  /** Accessible name, e.g. "Filter conversations by status". */
  label: string;
}

export default function StatusFilter({ choices, active, onChange, label }: Props) {
  return (
    <nav className="votes-filter" aria-label={label}>
      <ul className="votes-filter-list">
        {choices.map((c) => {
          const isActive = c.key === active;
          return (
            <li key={c.key}>
              <button
                type="button"
                className={`votes-filter-pill${isActive ? " is-active" : ""}`}
                onClick={() => onChange(c.key)}
                aria-pressed={isActive}
              >
                {c.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
