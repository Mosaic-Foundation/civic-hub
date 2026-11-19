import type { Hub } from "../config/hub";
import { useHub } from "../config/hub";
import { spaceNow } from "../host";
import { feedFilters } from "../processes";
import type { FeedFilterKey } from "./feedFilterState";
import "./FeedFilter.css";

/**
 * Slice 10 — filter pills above the feed.
 *
 * The pill choices: All, then each surface a type adds (its UI module's
 * `feedFilter`: Announcements, News, Meeting summaries on a Civic Hub), then
 * Activity. The kernel names none of them (kernel step 3, Nov 19). The active pill matches the type discriminator that
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
// Hidden when the hub switched the type's plugin off, or while it needs
// setup and has nothing to show (config/plugins.tsx).
function choices(hub: Hub): FeedFilterChoice[] {
  const space = spaceNow();
  return [
    { key: "all", label: "All", pillClass: "feed-filter-pill--all" },
    ...feedFilters()
      .filter((f) => hub.plugins.shown(f.plugin as never))
      .map((f) => ({ key: f.surface, label: f.label(space), pillClass: `feed-filter-pill--${f.pillClass}` })),
    { key: "activity", label: "Activity", pillClass: "feed-filter-pill--activity" },
  ];
}

interface Props {
  active: FeedFilterKey;
  onChange: (next: FeedFilterKey) => void;
}

export default function FeedFilter({ active, onChange }: Props) {
  const hub = useHub();
  return (
    <nav className="feed-filter" aria-label="Filter feed by post type">
      <ul className="feed-filter-list">
        {choices(hub).map((choice) => {
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
