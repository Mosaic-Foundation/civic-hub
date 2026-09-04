// Slice 12.1 — primary in-page tabs for the two big surfaces a
// resident comes here for: the chronological civic Feed, or the
// action-oriented Votes page.
//
// Implemented as React Router NavLinks so each tab is also a real
// route (/, /votes) — bookmarkable, back-button-safe, and the active
// state comes from the URL rather than a parallel piece of UI state.
//
// The tabs sit BELOW the banner / hub info, so they swap "what the
// page does" without competing with the site identity. Context-
// specific surfaces (filter pills on Feed, suggest-a-vote CTA on
// Votes) live below the tab strip on each page so they only appear
// when relevant.

import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import "./FeedVotesTabs.css";

const SCROLLABLE_TABS: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/deliberations", label: "Conversations" },
  { to: "/propose", label: "Proposals" },
  { to: "/votes", label: "Votes" },
  { to: "/projects", label: "Projects" },
  // Last: the archive of what has finished, after the surfaces where things
  // are still happening.
  { to: "/outcomes", label: "Outcomes" },
];

/**
 * A detail page belongs to a section even though its URL does not start
 * with the section's path (/proposal/:id lives under Proposals, /process/:id
 * under Votes, /brief/:id under Outcomes). Without this the tab bar went
 * quiet the moment you opened anything — on a phone, the only hint of what
 * kind of process you were reading (Adam, 2026-09-02).
 */
const DETAIL_SECTIONS: ReadonlyArray<{ prefix: string; tab: string }> = [
  { prefix: "/proposal/", tab: "/propose" },
  { prefix: "/process/", tab: "/votes" },
  { prefix: "/votes/", tab: "/votes" },
  { prefix: "/project/", tab: "/projects" },
  { prefix: "/deliberation/", tab: "/deliberations" },
  { prefix: "/brief/", tab: "/outcomes" },
  { prefix: "/vote-results/", tab: "/outcomes" },
];

function sectionFor(pathname: string): string | null {
  return DETAIL_SECTIONS.find((d) => pathname.startsWith(d.prefix))?.tab ?? null;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

export default function FeedVotesTabs() {
  const { pathname } = useLocation();
  const detailSection = sectionFor(pathname);

  const listRef = useRef<HTMLUListElement>(null);
  // Which directions still have tabs hidden off the edge. Drives both the
  // fades and the arrow buttons, so the hint is never shown when there is
  // nothing more to see (the old fade was painted permanently below 600px,
  // which made it decoration rather than a signal).
  const [more, setMore] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // 1px slack: fractional layout widths never settle exactly on the bound.
    setMore({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 });
  }, []);

  // Land every route change at the top of the page. The previous
  // scroll-to-tab-bar behavior (measure the nav offset, retry on
  // timers) could never be made reliable because the banner image
  // above the tabs loads asynchronously and shifts the layout after
  // measurement — so it was dropped in favor of this deterministic
  // default.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  // Bring the active tab into view. On a phone the strip is narrower than
  // its contents, so Projects and Outcomes sat off the right edge: you
  // opened the section and the bar showed no active tab at all (Adam,
  // 2026-09-04). Scrolling the container directly rather than with
  // scrollIntoView cannot move the page itself.
  //
  // The strip's content width is NOT final on first paint — the web font
  // loads afterwards and every label changes width — so a single pass on
  // mount measured no overflow and clamped the scroll back to 0. Hence
  // `centeredFor`: retry across layout settling until the tabs actually
  // overflow, then centre once and leave the strip alone, so a manual
  // scroll is never yanked back.
  const centeredFor = useRef<string | null>(null);

  const centerActive = useCallback(() => {
    const el = listRef.current;
    if (!el || centeredFor.current === pathname) return;
    const active = el.querySelector<HTMLElement>(".feed-votes-tab.is-active");
    if (!active) {
      // Feed (pinned outside the list) — show the start of the sections.
      el.scrollLeft = 0;
      centeredFor.current = pathname;
      return;
    }
    const max = el.scrollWidth - el.clientWidth;
    // Nothing hidden yet: either the strip fits (desktop — the active tab is
    // already visible) or layout has not settled. Either way don't record it
    // as done; a later pass catches the overflow if it appears.
    if (max <= 0) return;
    const listBox = el.getBoundingClientRect();
    const activeBox = active.getBoundingClientRect();
    const centered =
      el.scrollLeft + (activeBox.left - listBox.left) - (el.clientWidth - activeBox.width) / 2;
    // Assigned rather than animated: a smooth scroll started during page load
    // gets cancelled by the layout shifts still happening around it, which
    // left Votes and Projects parked at 0 with their tab off-screen.
    el.scrollLeft = Math.max(0, Math.min(centered, max));
    // Only call it done once the tab really is in view, so a pass that ran
    // against half-settled layout is retried rather than trusted.
    const settled = active.getBoundingClientRect();
    const bounds = el.getBoundingClientRect();
    if (settled.left >= bounds.left - 1 && settled.right <= bounds.right + 1) {
      centeredFor.current = pathname;
    }
  }, [pathname]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    centeredFor.current = null;

    const settle = () => {
      centerActive();
      measure();
    };
    settle();
    const frame = requestAnimationFrame(settle);
    // Label widths change when the web font swaps in.
    document.fonts?.ready.then(settle).catch(() => undefined);

    el.addEventListener("scroll", measure, { passive: true });
    // Catches rotation and window resizes; `settle` rather than `measure` so
    // a strip that only starts overflowing at the new width still centres
    // its active tab.
    const observer = new ResizeObserver(settle);
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [pathname, measure, centerActive]);

  const page = useCallback((direction: 1 | -1) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollBy({
      left: direction * Math.round(el.clientWidth * 0.8),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, []);

  return (
    <nav className="feed-votes-tabs" aria-label="Primary content">
      <div className="feed-votes-tabs-pinned">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `feed-votes-tab${isActive ? " is-active" : ""}`
          }
        >
          Feed
        </NavLink>
        <span className="feed-votes-tab-divider-line" aria-hidden="true" />
      </div>
      <div className="feed-votes-tabs-scroller">
        <ul className="feed-votes-tabs-list" ref={listRef}>
          {SCROLLABLE_TABS.map((t) => (
            <li key={t.to}>
              <NavLink
                to={t.to}
                className={({ isActive }) =>
                  `feed-votes-tab${isActive || detailSection === t.to ? " is-active" : ""}`
                }
                aria-current={detailSection === t.to ? "page" : undefined}
              >
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
        {/* Redundant for keyboard and screen-reader users — tabbing through
            the links scrolls them into view natively — so these are pointer
            affordances only. */}
        <button
          type="button"
          className={`feed-votes-tabs-arrow feed-votes-tabs-arrow--left${more.left ? " is-visible" : ""}`}
          onClick={() => page(-1)}
          tabIndex={-1}
          aria-hidden="true"
        >
          <span className="feed-votes-tabs-arrow-chip">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path
                d="M15 5 8 12l7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>
        <button
          type="button"
          className={`feed-votes-tabs-arrow feed-votes-tabs-arrow--right${more.right ? " is-visible" : ""}`}
          onClick={() => page(1)}
          tabIndex={-1}
          aria-hidden="true"
        >
          <span className="feed-votes-tabs-arrow-chip">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path
                d="M9 5l7 7-7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>
      </div>
    </nav>
  );
}
