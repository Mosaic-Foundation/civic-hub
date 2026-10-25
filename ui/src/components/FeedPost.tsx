import { Link } from "react-router-dom";
import type { CivicEvent } from "../services/api";
import { useIsWideViewport } from "../hooks/useIsWideViewport";
import SampleBadge from "./SampleBadge";
import { typeDisplay } from "../config/navigation";
import {
  classifyActivity,
  type Activity,
  type ActivityColor,
  type ActivityKind,
} from "../../../src/shared/feedActivity";
import { feedKindUi } from "../processes";
import { summaryFromDescription } from "../processes/feedText";
import { absoluteTime, relativeTime } from "../utils/dates";
import type { CardText } from "../processes/types";

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
 * The few moments the type pill doesn't say by itself (Adam, 2026-10-14). A
 * new vote, proposal or project needs no word: the pill and the date say it.
 */
const ACTIVITY_NOTES: Partial<Record<ActivityKind, string>> = {
  "project-updated": "Update",
  "brief-response": "Official response",
  "vote-closed": "Results",
  "proposal-closed": "Results",
  "conversation-results": "Results",
};

/**
 * The process type an event is about: the `data.process.type` discriminator
 * an emitter stamps via emitEvent, with the legacy flat fallback. Undefined
 * for a legacy event with neither.
 */
export function eventProcessType(event: CivicEvent): string | undefined {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const nested = (data.process as { type?: unknown } | undefined)?.type;
  if (typeof nested === "string") return nested;
  const flat = (data as { process_type?: unknown }).process_type;
  if (typeof flat === "string") return flat;
  return undefined;
}

/**
 * Build a feed post from a civic event.
 *
 * Phase 3 — feed-worthiness, pill, kind, and href all come from the single
 * shared `classifyActivity` (src/shared/feedActivity.ts). This function no
 * longer discriminates process types by sniffing `data` shape; it only turns
 * the classifier's verdict into a renderable view, deriving the title and
 * summary (which need fetched per-process metadata) from the getters the Feed
 * container supplies. Returns null when the event is not feed-worthy.
 */
export function eventToPost(
  event: CivicEvent,
  getProcessDescription: (processId: string) => string | undefined,
  getProcessTitle: (processId: string) => string | undefined,
): FeedPostView | null {
  const activity = classifyActivity(event);
  if (!activity) return null;

  const { title, summary, authorName, engagement } = buildTitleSummary(
    activity,
    event,
    getProcessTitle,
    getProcessDescription,
  );

  return {
    id: event.id,
    title,
    engagement: engagement ?? null,
    // The type's own label (design A, navigation slice 2026-10-14): one
    // word per kind of thing, from the registry, so a plugin's type gets its
    // pill with no change here.
    pillLabel: typeDisplay(eventProcessType(event))?.label ?? activity.pill,
    note: ACTIVITY_NOTES[activity.kind] ?? null,
    pillKind: activity.kind,
    pillColor: activity.color,
    summary,
    timestamp: event.timestamp,
    href: activity.href,
    authorName: authorName ?? null,
    sample: event.sample,
  };
}

/**
 * Derive the title/summary/author for a card from its classified kind plus the
 * event payload and the lazily-fetched per-process metadata. Pure presentation
 * — the feed-worthiness decision already happened in classifyActivity, and
 * each kind's wording lives with its process type (ui/src/processes/).
 */
function buildTitleSummary(
  activity: Activity,
  event: CivicEvent,
  getTitle: (id: string) => string | undefined,
  getDescription: (id: string) => string | undefined,
): CardText {
  const id = event.process_id;
  const ui = feedKindUi(activity.kind);
  // A kind no module claims: no wording to give.
  if (!ui) return { title: "", summary: "" };
  return ui.card({
    activity,
    event,
    id,
    data: event.data as Record<string, unknown>,
    getTitle,
    getDescription,
    descSummary: summaryFromDescription(getDescription(id)),
  });
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
  const pillClass = `feed-pill feed-pill--type-${post.pillColor}`;
  const hasImage = Boolean(post.imageUrl);
  const articleClass = `feed-post feed-post--type-${post.pillColor}${
    hasImage ? " has-image" : ""
  }`;

  // When an attached image exists, the card uses a side-by-side layout
  // (text left, square thumbnail right) on desktop and stacks the image
  // above with a capped height on mobile — see Feed.css. Imageless cards
  // continue to render as a single text column.
  const inner = (
    <>
      <div className="feed-post-body">
        <h2 className="feed-post-title">{post.title}</h2>
        {/* Design A (Adam, 2026-10-14): the type's pill leads the meta line,
            beside what happened, the author and the date; the title keeps
            the full width. The label says the type, so nothing rests on the
            pill's colour. */}
        <p className="feed-post-meta">
          <span className={pillClass} data-testid="feed-type-pill">{post.pillLabel}</span>
          {post.sample && <SampleBadge />}
          {post.note && <span className="feed-post-note">{post.note}</span>}
          {post.authorName && <span className="feed-post-author">{post.authorName}</span>}
          <time
            className="feed-post-time"
            dateTime={post.timestamp}
            title={absoluteTime(post.timestamp)}
          >
            {relativeTime(post.timestamp)}
          </time>
        </p>
        {post.summary && <p className="feed-post-summary">{post.summary}</p>}
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
      </div>
      {hasImage && (
        <span className="feed-post-image">
          <img
            src={post.imageUrl ?? ""}
            alt={post.imageAlt ?? ""}
            loading="lazy"
            decoding="async"
          />
        </span>
      )}
    </>
  );

  return (
    <article className={articleClass}>
      {classified.kind === "internal" ? (
        <Link to={classified.to} className="feed-post-link">
          {inner}
        </Link>
      ) : (
        <a
          href={post.href}
          className="feed-post-link"
          {...(isWideViewport
            ? { target: "_blank", rel: "noopener noreferrer" }
            : { rel: "noopener" })}
        >
          {inner}
        </a>
      )}
    </article>
  );
}
