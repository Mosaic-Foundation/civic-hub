import { Link } from "react-router-dom";
import type { CivicEvent } from "../services/api";
import { useIsWideViewport } from "../hooks/useIsWideViewport";
import hub from "../config/hub";
import {
  briefResponseContext,
  classifyActivity,
  type Activity,
  type ActivityKind,
} from "../../../src/shared/feedActivity";

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
  pillLabel: string;
  pillKind: FeedPillKind;
  summary: string;
  timestamp: string; // ISO 8601
  href: string;
  authorName?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
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
    // The classifier's pill label is canonical/hub-agnostic ("Meeting
    // summary"), which the email digest uses. On the feed card we prefix the
    // governing body so the card pill matches the feed's filter pill
    // (`${governing_body_short} meeting summaries`).
    pillLabel:
      activity.kind === "meeting"
        ? `${hub.governing_body_short} meeting summary`
        : activity.pill,
    pillKind: activity.kind,
    summary,
    timestamp: event.timestamp,
    href: activity.href,
    authorName: authorName ?? null,
  };
}

/**
 * Derive the title/summary/author for a card from its classified kind plus the
 * event payload and the lazily-fetched per-process metadata. Pure presentation
 * — the feed-worthiness decision already happened in classifyActivity.
 */
function buildTitleSummary(
  activity: Activity,
  event: CivicEvent,
  getTitle: (id: string) => string | undefined,
  getDescription: (id: string) => string | undefined,
): {
  title: string;
  summary: string;
  authorName?: string | null;
  /** Event-derived metadata line. When set, it wins over the Feed
   *  container's fetched-meta buildEngagement (which knows nothing about
   *  this event's payload). */
  engagement?: string | null;
} {
  const id = event.process_id;
  const data = event.data as Record<string, unknown>;
  const descSummary = summaryFromDescription(getDescription(id));

  switch (activity.kind) {
    case "vote-open":
      return { title: getTitle(id) ?? "Untitled vote", summary: descSummary };

    case "vote-results": {
      const headline =
        typeof data.headline_result === "string" ? data.headline_result : "";
      return {
        title: getTitle(id) ?? "Vote results",
        // Summary carries context; the participation/comment counts live on
        // the engagement line so the two don't both say "N residents voted".
        summary: headline || `Delivered to the ${hub.governing_body_name}.`,
      };
    }

    case "wordcloud":
      return { title: getTitle(id) ?? "Word Cloud", summary: descSummary };

    case "announcement":
    case "announcement-author": {
      const ann = data.announcement as
        | { title?: string; author_display_name?: string | null }
        | undefined;
      return {
        title: ann?.title ?? getTitle(id) ?? "Announcement",
        summary: descSummary,
        authorName: ann?.author_display_name ?? null,
      };
    }

    case "meeting": {
      const ms = data.meeting_summary as
        | { meeting_title?: string; meeting_date?: string }
        | undefined;
      const meetingDate =
        ms?.meeting_date ??
        (typeof data.meeting_date === "string" ? data.meeting_date : "") ??
        "";
      const meetingTitle =
        ms?.meeting_title ??
        (typeof data.meeting_title === "string" ? data.meeting_title : undefined) ??
        getTitle(id);
      const baseTitle = meetingTitle || "Meeting summary";
      const dateStr = meetingDate ? formatMeetingDate(meetingDate) : "";
      return { title: dateStr ? `${baseTitle} — ${dateStr}` : baseTitle, summary: "" };
    }

    case "proposal": {
      const prop = data.proposal as { title?: string } | undefined;
      return {
        title: prop?.title ?? getTitle(id) ?? "New proposal",
        summary: descSummary,
      };
    }

    case "proposal-closed":
      return { title: getTitle(id) ?? "Proposal", summary: descSummary };

    case "project-created": {
      const proj = data.project as { title?: string } | undefined;
      return {
        title: proj?.title ?? getTitle(id) ?? "New project",
        summary: descSummary,
      };
    }

    case "project-updated":
      return { title: getTitle(id) ?? "Project update", summary: "" };

    case "conversation": {
      const proc = data.process as { title?: string } | undefined;
      return {
        title: proc?.title ?? getTitle(id) ?? "New conversation",
        summary: descSummary,
      };
    }

    case "conversation-results":
      return { title: getTitle(id) ?? "Conversation results", summary: descSummary };

    case "brief": {
      // Rendered from the publish event alone (no metadata fetch): the
      // process title as the card title, the outcome headline as summary.
      const brief = (data.brief ?? {}) as { title?: string; headline?: string };
      return {
        title: brief.title ?? getTitle(id) ?? "Civic Brief",
        summary: brief.headline ?? "",
      };
    }

    case "brief-response": {
      // Rendered from the response event alone: the brief's title as the
      // card title, the official as the byline, and the shared context
      // line ("Responding to the community's Civic Brief on this …") in
      // the metadata slot. NO excerpt of the response — a truncated quote
      // can misrepresent an official statement (Adam, 2026-08-28); the
      // card links to /brief/:id where every response (including any
      // collapsed under the 24h anchor) reads in full and in context.
      const brief = (data.brief ?? {}) as {
        title?: string;
        source_process_type?: string;
      };
      const response = (data.response ?? {}) as {
        official_title?: string;
        responder_name?: string;
      };
      const byline = [response.responder_name, response.official_title]
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .join(", ");
      return {
        title: brief.title ?? getTitle(id) ?? "Civic Brief",
        summary: "",
        authorName: byline || null,
        engagement: briefResponseContext(brief.source_process_type),
      };
    }
  }
}

function summaryFromDescription(description: string | undefined): string {
  if (!description) return "";
  const firstLine = description.split(/\r?\n/).find((l) => l.trim().length > 0);
  return firstLine?.trim() ?? "";
}

/**
 * Format a YYYY-MM-DD (or full ISO) date for feed post titles. Falls back
 * to the raw string if parsing fails, so truncated or malformed dates
 * don't render as "Invalid Date".
 */
function formatMeetingDate(iso: string): string {
  if (!iso) return "(date unknown)";
  const d = iso.includes("T")
    ? new Date(iso)
    : new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Relative time string per Slice-8 rules. < 7 days renders relative;
 * older renders as an absolute short date (e.g. "Apr 14, 2026"). The
 * full datetime is exposed via the `title` attribute by the caller.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return then.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function absoluteTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} at ${time}`;
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
  const pillClass = `feed-pill feed-pill--${post.pillKind}`;
  const hasImage = Boolean(post.imageUrl);
  const articleClass = `feed-post feed-post--${post.pillKind}${
    hasImage ? " has-image" : ""
  }`;

  // When an attached image exists, the card uses a side-by-side layout
  // (text left, square thumbnail right) on desktop and stacks the image
  // above with a capped height on mobile — see Feed.css. Imageless cards
  // continue to render as a single text column.
  const inner = (
    <>
      <div className="feed-post-body">
        <div className="feed-post-head">
          <h2 className="feed-post-title">{post.title}</h2>
          <span className={pillClass}>{post.pillLabel}</span>
        </div>
        {post.authorName && (
          <p className="feed-post-author">{post.authorName}</p>
        )}
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
        <time
          className="feed-post-time"
          dateTime={post.timestamp}
          title={absoluteTime(post.timestamp)}
        >
          {relativeTime(post.timestamp)}
        </time>
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
