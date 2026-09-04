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

/** Once per visit, the strip shows what it does: it slides to the far end of
 *  the hidden tabs and back, slowly, then leaves itself where it started.
 *  Adam (2026-09-04) asked for this instead of a louder static indicator —
 *  "it's an indicator, I feel like that's more subtle". Any touch, wheel or
 *  key hands control straight back to the person, mid-slide.
 *
 *  It waits for the reader to scroll a real distance first. On load their
 *  attention is on the banner and the headline, not a strip they have not
 *  needed yet, so the sweep was being spent while nobody was looking (Adam:
 *  trigger it "when you scroll a decent distance… that's when the user will
 *  be paying attention to it"). The strip is sticky, so it is on screen and
 *  under the eye by the time this fires. */
const PEEK_SEEN_KEY = "civic:tabs-peeked";
/** About halfway down the banner image — the point where the reader has
 *  started moving through the page but the strip is still the next thing
 *  they meet (Adam, 2026-09-04: "when I scroll about halfway through the
 *  banner image or so"). Measured off the banner rather than hardcoded, so
 *  changing its height moves this with it; the fallback is half of the
 *  240px `.hub-banner` for pages that render no banner. */
const PEEK_FALLBACK_TRIGGER_PX = 120;

function peekTriggerPx(): number {
  const banner = document.querySelector(".hub-banner, .project-banner");
  const height = banner?.getBoundingClientRect().height ?? 0;
  return height > 0 ? height / 2 : PEEK_FALLBACK_TRIGGER_PX;
}
const PEEK_OUT_MS = 1200;
const PEEK_HOLD_MS = 250;
const PEEK_BACK_MS = 1000;

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
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

  // The one-time peek. Runs after the strip has settled, only when tabs are
  // actually hidden, never under prefers-reduced-motion, and at most once a
  // visit — the point is to teach the gesture, not to animate on every page.
  const peeked = useRef(false);
  useEffect(() => {
    const el = listRef.current;
    if (!el || peeked.current || prefersReducedMotion()) return;
    try {
      if (sessionStorage.getItem(PEEK_SEEN_KEY) === "1") return;
    } catch {
      return; // storage unavailable: don't risk replaying it on every route
    }

    let frame = 0;
    let startedAt = 0;
    let done = false;
    const handOver = () => {
      done = true;
      cancelAnimationFrame(frame);
      detach();
    };
    const gestures = ["pointerdown", "touchstart", "wheel", "keydown"] as const;
    const detach = () => {
      for (const type of gestures) el.removeEventListener(type, handOver);
    };

    const sweep = () => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return; // nothing hidden — nothing to demonstrate
      peeked.current = true;
      try {
        sessionStorage.setItem(PEEK_SEEN_KEY, "1");
      } catch {
        /* best effort */
      }
      const from = el.scrollLeft;
      // Head for whichever side is hiding more, so the sweep always reveals
      // something: from the Feed that is the full run out to Outcomes.
      const to = max - from >= from ? max : 0;
      for (const type of gestures) {
        el.addEventListener(type, handOver, { passive: true });
      }
      const total = PEEK_OUT_MS + PEEK_HOLD_MS + PEEK_BACK_MS;
      const step = (now: number) => {
        if (done) return;
        if (startedAt === 0) startedAt = now;
        const t = now - startedAt;
        if (t >= total) {
          el.scrollLeft = from;
          measure();
          detach();
          return;
        }
        if (t < PEEK_OUT_MS) {
          el.scrollLeft = from + (to - from) * easeInOut(t / PEEK_OUT_MS);
        } else if (t < PEEK_OUT_MS + PEEK_HOLD_MS) {
          el.scrollLeft = to;
        } else {
          el.scrollLeft =
            to + (from - to) * easeInOut((t - PEEK_OUT_MS - PEEK_HOLD_MS) / PEEK_BACK_MS);
        }
        measure();
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };

    // Wait until the reader has started moving down the page — far enough to
    // be looking below the banner, where the sticky strip is what they meet
    // next — but no further, so the sweep is not saved for a scroll depth
    // most people never reach.
    const onScroll = () => {
      if (done || peeked.current) return;
      if (window.scrollY < peekTriggerPx()) return;
      window.removeEventListener("scroll", onScroll);
      sweep();
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      handOver();
    };
  }, [measure]);

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
