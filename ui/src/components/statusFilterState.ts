// The ?status= filter (split from StatusFilter.tsx, which holds the bar).

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
