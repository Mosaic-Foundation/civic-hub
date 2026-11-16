import type { Hub } from "../config/hub";
import { useHub } from "../config/hub";
import type { FeedFilterKey } from "./feedFilterState";
import "./FeedFilter.css";

/**
 * Slice 10 — filter pills above the feed.
 *
 * The pill choices: All / Announcements / News / Meeting summaries /
 * Activity. The active pill matches the type discriminator that
 * Feed.tsx::kindFromEvent already uses, so the visible cards always
 * agree with the filter selection.
 *
 * State is mirrored in the URL as `?type=<key>` so a filter view is
 * bookmarkable and shareable. Missing param = "all". `useSearchParams`
 * preserves any other query params (the auth flow uses `?token=` etc.).
 */

export interface FeedFilterChoice {
  key: FeedFilterKey;
  label: string;
  /** Pill modifier for color tokens — see Feed.css for the matching classes. */
  pillClass: string;
}

// A function, not a constant: the labels read the hub's settings, which
// arrive after this module loads. A constant built here said "Board" on
// every hub (2026-10-06).
function choices(hub: Hub): FeedFilterChoice[] {
  return [
    { key: "all", label: "All", pillClass: "feed-filter-pill--all" },
    {
      key: "announcement",
      label: "Announcements",
      pillClass: "feed-filter-pill--announcement",
    },
    // Posts News Sync copies in from another site (2026-11-16).
    { key: "news", label: "News", pillClass: "feed-filter-pill--news" },
    {
      key: "meeting_summary",
      label: hub.meetingSummaryLabel(true),
      pillClass: "feed-filter-pill--meeting",
    },
    {
      key: "activity",
      label: "Activity",
      pillClass: "feed-filter-pill--activity",
    },
  ];
}

interface Props {
  active: FeedFilterKey;
  onChange: (next: FeedFilterKey) => void;
}

// Hidden when the hub switched the plugin off, or while it needs setup and
// has nothing to show (config/plugins.tsx).
function visibleChoices(hub: Hub): FeedFilterChoice[] {
  return choices(hub).filter((choice) => {
    if (choice.key === "announcement") return hub.plugins.shown("announcement");
    // News Sync saves its posts as announcements, so it needs both on.
    if (choice.key === "news") return hub.plugins.shown("news_sync") && hub.plugins.enabled("announcement");
    if (choice.key === "meeting_summary") return hub.plugins.shown("meeting_summary");
    return true;
  });
}

export default function FeedFilter({ active, onChange }: Props) {
  const hub = useHub();
  return (
    <nav className="feed-filter" aria-label="Filter feed by post type">
      <ul className="feed-filter-list">
        {visibleChoices(hub).map((choice) => {
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
