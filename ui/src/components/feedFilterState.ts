// The feed's ?type= filter (split from FeedFilter.tsx, which holds the pills).

import { useSearchParams } from "react-router-dom";

export type FeedFilterKey =
  | "all"
  | "announcement"
  | "meeting_summary"
  | "activity";

const PARAM = "type";

function isFilterKey(v: string | null): v is FeedFilterKey {
  return (
    v === "announcement" ||
    v === "meeting_summary" ||
    v === "activity"
  );
}

/**
 * Public hook — read the current filter from the URL. Returns "all"
 * when the param is missing or unknown. Used by the parent (Home.tsx)
 * to tell <Feed> which surface to ask the server for.
 */
export function useFeedFilter(): {
  active: FeedFilterKey;
  setActive: (next: FeedFilterKey) => void;
} {
  const [params, setParams] = useSearchParams();
  const raw = params.get(PARAM);
  const active: FeedFilterKey = isFilterKey(raw) ? raw : "all";

  function setActive(next: FeedFilterKey) {
    const updated = new URLSearchParams(params);
    if (next === "all") {
      updated.delete(PARAM);
    } else {
      updated.set(PARAM, next);
    }
    // `replace` keeps the back button focused on cross-page navigation,
    // not a stack of filter changes.
    setParams(updated, { replace: true });
  }

  return { active, setActive };
}
