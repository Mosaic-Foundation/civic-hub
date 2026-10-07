import { useSearchParams } from "react-router-dom";
import { meetingSummaryLabel } from "../config/hub";
import { pluginShown } from "../config/plugins";
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

// A function, not a constant: the labels read the hub's settings, which
// arrive after this module loads. A constant built here said "Board" on
// every hub (2026-10-06).
function choices(): FeedFilterChoice[] {
  return [
    { key: "all", label: "All", pillClass: "feed-filter-pill--all" },
    {
      key: "announcement",
      label: "Announcements",
      pillClass: "feed-filter-pill--announcement",
    },
    {
      key: "meeting_summary",
      label: meetingSummaryLabel(true),
      pillClass: "feed-filter-pill--meeting",
    },
    {
      key: "activity",
      label: "Activity",
      pillClass: "feed-filter-pill--activity",
    },
  ];
}

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

interface Props {
  active: FeedFilterKey;
  onChange: (next: FeedFilterKey) => void;
}

// Hidden when the hub switched the plugin off, or while it needs setup and
// has nothing to show (config/plugins.tsx).
function visibleChoices(): FeedFilterChoice[] {
  return choices().filter((choice) => {
    if (choice.key === "announcement") return pluginShown("announcement");
    if (choice.key === "meeting_summary") return pluginShown("meeting_summary");
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
