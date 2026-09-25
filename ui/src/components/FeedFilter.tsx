import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import hub from "../config/hub";
import { pluginEnabled } from "../config/plugins";
import {
  classifyActivity,
  type ClassifierEvent,
} from "../../../src/shared/feedActivity";
import "./FeedFilter.css";

/**
 * Slice 10 — filter pills above the feed.
 *
 * Five pill choices: All / Votes / Announcements / Vote results / Meeting
 * summaries. The active pill matches the type discriminator that
 * Feed.tsx::kindFromEvent already uses, so the visible cards always
 * agree with the filter selection.
 *
 * State is mirrored in the URL as `?type=<key>` so a filter view is
 * bookmarkable and shareable. Missing param = "all". `useSearchParams`
 * preserves any other query params (the auth flow uses `?token=` etc.).
 */

export type FeedFilterKey =
  | "all"
  | "announcement"
  | "meeting_summary"
  | "activity";

export interface FeedFilterChoice {
  key: FeedFilterKey;
  label: string;
  /** Pill modifier for color tokens — see Feed.css for the matching classes. */
  pillClass: string;
}

const CHOICES: FeedFilterChoice[] = [
  { key: "all", label: "All", pillClass: "feed-filter-pill--all" },
  {
    key: "announcement",
    label: "Announcements",
    pillClass: "feed-filter-pill--announcement",
  },
  {
    key: "meeting_summary",
    label: `${hub.governing_body_short} meeting summaries`,
    pillClass: "feed-filter-pill--meeting",
  },
  {
    key: "activity",
    label: "Activity",
    pillClass: "feed-filter-pill--activity",
  },
];

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
 * to compose the filter predicate it passes into <Feed>.
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

interface Props {
  active: FeedFilterKey;
  onChange: (next: FeedFilterKey) => void;
}

// Hidden when the hub switched the plugin off (config/plugins.tsx).
function visibleChoices(): FeedFilterChoice[] {
  return CHOICES.filter((choice) => {
    if (choice.key === "announcement") return pluginEnabled("announcement");
    if (choice.key === "meeting_summary") return pluginEnabled("meeting_summary");
    return true;
  });
}

export default function FeedFilter({ active, onChange }: Props) {
  return (
    <nav className="feed-filter" aria-label="Filter feed by post type">
      <ul className="feed-filter-list">
        {visibleChoices().map((choice) => {
          const isActive = choice.key === active;
          const cls = [
            "feed-filter-pill",
            choice.pillClass,
            isActive ? "is-active" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li key={choice.key}>
              <button
                type="button"
                className={cls}
                onClick={() => onChange(choice.key)}
                aria-pressed={isActive}
              >
                {choice.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Build the predicate Feed.tsx::Props.filter expects from the active filter
 * key. Phase 3 — the filter category is just the shared classifier's
 * `surface` field (the FeedFilterKeys are aligned to ActivitySurface), so the
 * filter, the inclusion gate, and the rendered pills can no longer disagree.
 * This was previously a fourth hand-maintained copy of the data-shape ladder
 * and the source of the "filter shows fewer items than All" drift.
 */
export function buildFilterPredicate(
  key: FeedFilterKey,
): ((event: ClassifierEvent) => boolean) | undefined {
  if (key === "all") return undefined;
  return (event) => classifyActivity(event)?.surface === key;
}

/**
 * Convenience wrapper: returns a predicate-ready memoized value tied
 * to the active key. Caller passes the result straight to <Feed>.
 */
export function useFilterPredicate(active: FeedFilterKey) {
  return useMemo(() => buildFilterPredicate(active), [active]);
}

