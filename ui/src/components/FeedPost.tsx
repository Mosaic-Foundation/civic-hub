import { Link } from "react-router-dom";
import { useIsWideViewport } from "../hooks/useIsWideViewport";
import SampleBadge from "./SampleBadge";
import { ListCard } from "../kit";
import type { ActivityColor, ActivityKind } from "../../../src/shared/feedActivity";
import { absoluteTime, relativeTime } from "../utils/dates";

/**
 * Color/label kind for the per-post type pill. Phase 3 — this IS the shared
 * classifier's ActivityKind: the gate, the renderer, the filter, and the email
 * digest all speak one vocabulary, so they can no longer drift. Each kind maps
 * to a token in theme.css / Feed.css (--pill-<kind>-* and .feed-pill--<kind>).
 */
export type FeedPillKind = ActivityKind;

/**
 * Display model for a feed post. Constructed from a CivicEvent by the Feed
 * container — FeedPost itself does no fetching, so it stays deterministic and
 * cheap to render. Title and pill are intentionally separate fields: the
 * pill renders as its own element beside the title rather than being baked
 * into the title string.
 *
 * Slice 9 — leading visual: only renders an attached image when the
 * post has one. Cards without an image render plain (no gradient cover,
 * no OG fallback) — the per-card colored top border + pill carry the
 * type signal cheaply, and the feed stays scannable.
 */
export interface FeedPostView {
  id: string;
  title: string;
  /** The item's type, from the registry ("Vote"); the classifier's wording when the type is unknown. */
  pillLabel: string;
  /**
   * What happened, where the type alone doesn't say it: "Update", "Official
   * response", "Results" (Adam, 2026-10-14). Muted text after the pill.
   */
  note?: string | null;
  pillKind: FeedPillKind;
  /** Process-type color key — selects the feed-pill--type-<color> class.
   *  See ActivityColor in feedActivity.ts: one color per process type,
   *  shared with Outcomes and the digest. */
  pillColor: ActivityColor;
  summary: string;
  timestamp: string; // ISO 8601
  href: string;
  authorName?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  /** Seeded sample content (Phase 7): the event's process is a planted
   *  sample row — renders the Sample badge beside the type pill. */
  sample?: boolean;
  /**
   * Slice 10 — compact engagement / metadata line rendered between the
   * summary and the timestamp. Empty / missing → suppressed entirely
   * so cards with no real engagement don't show a "0 residents voted"
   * line. The Feed container builds this from the per-process
   * metadata it already fetches lazily — see Feed.tsx::buildEngagement.
   */
  engagement?: string | null;
}

interface Props {
  post: FeedPostView;
}

/**
 * Classify an action_url as either an internal SPA route or external link.
 * (See history note on action_url origins in the previous slice's
 * HANDOFF — backend currently emits API-origin URLs and we route any
 * known SPA pathname through React Router regardless of origin.)
 */
function classifyHref(href: string): { kind: "internal"; to: string } | { kind: "external" } {
  try {
    const url = new URL(href, window.location.origin);
    if (/^\/process\/[^/]+\/?$/.test(url.pathname)) {
      return { kind: "internal", to: url.pathname };
    }
    if (/^\/vote-results\/[^/]+\/?$/.test(url.pathname)) {
      return { kind: "internal", to: url.pathname };
    }
    // Legacy /brief/:id action_urls from events emitted before Slice
    // 8.5. Routed internally so the SPA can do its <Navigate> redirect
    // to /vote-results/:id (App.tsx) rather than full-page bouncing
    // through the backend's 301.
    if (/^\/brief\/[^/]+\/?$/.test(url.pathname)) {
      return { kind: "internal", to: url.pathname };
    }
    if (/^\/announcement\/[^/]+\/?$/.test(url.pathname)) {
      return { kind: "internal", to: url.pathname };
    }
    if (/^\/meeting-summary\/[^/]+\/?$/.test(url.pathname)) {
      return { kind: "internal", to: url.pathname };
    }
    if (/^\/wordcloud\/[^/]+\/?$/.test(url.pathname)) {
      return { kind: "internal", to: url.pathname };
    }
    if (url.origin === window.location.origin) {
      return { kind: "internal", to: url.pathname + url.search };
    }
    return { kind: "external" };
  } catch {
    return { kind: "external" };
  }
}

export default function FeedPost({ post }: Props) {
  const classified = classifyHref(post.href);
  // External links open in a new tab on desktop (multi-tab is the
  // dominant research pattern there) but stay in the same tab on
  // mobile so the browser back button + iOS's native "back to Floyd
  // Civic Hub" chip both work. Power users can still ⌘-click /
  // middle-click to force a new tab on either device.
  const isWideViewport = useIsWideViewport();

  // The card is the kit's ListCard in its feed form (Events 3, 2026-11-08):
  // the title, then the meta line (the kind's chip, what happened, the
  // author, the date), the summary and the engagement line; a picture on the
  // right on desktop, above on a phone (kit/patterns.css).
  // Design A (Adam, 2026-10-14): the type's chip leads the meta line; the
  // label says the type, so nothing rests on the chip's colour.
  return (
    <ListCard
      pill="meta"
      kind={post.pillColor}
      kindLabel={post.pillLabel}
      title={post.title}
      badges={post.sample ? <SampleBadge /> : undefined}
      meta={[
        post.note ? <span key="note" className="feed-post-note">{post.note}</span> : null,
        post.authorName ? <span key="author" className="feed-post-author">{post.authorName}</span> : null,
        <time key="time" className="feed-post-time" dateTime={post.timestamp} title={absoluteTime(post.timestamp)}>
          {relativeTime(post.timestamp)}
        </time>,
      ]}
      summary={post.summary || null}
      image={post.imageUrl ? { src: post.imageUrl, alt: post.imageAlt ?? "" } : null}
      href={classified.kind === "internal" ? classified.to : post.href}
      linkAs={classified.kind === "internal" ? Link : undefined}
      linkProps={
        classified.kind === "internal"
          ? undefined
          : isWideViewport
            ? { target: "_blank", rel: "noopener noreferrer" }
            : { rel: "noopener" }
      }
    >
      {post.engagement && (
        <p
          className={
            post.pillKind === "brief-response"
              ? "feed-post-engagement feed-post-engagement--context"
              : "feed-post-engagement"
          }
        >
          {post.engagement}
        </p>
      )}
    </ListCard>
  );
}
