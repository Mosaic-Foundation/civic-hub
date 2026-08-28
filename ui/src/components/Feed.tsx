import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import hub from "../config/hub";
import {
  type CivicEvent,
  type VoteState,
  getAnnouncement,
  getFeed,
  getMeetingSummary,
  getProcessState,
  getProjectDetail,
  getPublicVoteResults,
  getWordcloud,
} from "../services/api";
import {
  classifyActivity,
  type ActivityKind,
} from "../../../src/shared/feedActivity";
import FeedPost, {
  eventToPost,
  relativeTime,
  type FeedPillKind,
  type FeedPostView,
} from "./FeedPost";
import "./Feed.css";

const PAGE_SIZE = 50;

interface Props {
  /**
   * Optional filter predicate applied before pagination. The Slice 10
   * <FeedFilter> component composes one of these from the URL `?type=`
   * param. When undefined, all events are shown.
   */
  filter?: (event: CivicEvent) => boolean;
  /**
   * Slice 10 — when a filter is active and yields zero matches, render
   * a scoped empty state with this action (typically "Show all
   * activity" → reset). Pass `null` to suppress the action button
   * entirely (used when the active filter is "all" — caller never
   * passes the action in that case).
   */
  emptyFilteredAction?: { label: string; onClick: () => void } | null;
}

interface ProcessMeta {
  title?: string;
  description?: string;
  /**
   * Slice 9 — the post's attached image (if any). When set, the feed
   * card uses it as a leading visual; when unset, the card renders
   * plain (no gradient cover, no OG fallback).
   */
  imageUrl?: string | null;
  imageAlt?: string | null;
  /**
   * Slice 10 — engagement counts surfaced as a metadata line on the
   * card. Each post type fills a different subset:
   *
   *   vote-open      → totalVotes
   *   vote-results   → totalVotes (= participation_count) + commentsCount
   *   announcement   → editCount + lastEditedAt (ISO)
   *   meeting        → blockCount + maxStartSeconds (for duration)
   *
   * eventToPost reads from these and builds the engagement string.
   */
  totalVotes?: number;
  commentsCount?: number;
  editCount?: number;
  lastEditedAt?: string | null;
  blockCount?: number;
  maxStartSeconds?: number | null;
}

export default function Feed({ filter, emptyFilteredAction }: Props) {
  const [events, setEvents] = useState<CivicEvent[]>([]);
  const [processMeta, setProcessMeta] = useState<Record<string, ProcessMeta>>({});
  // Slice 11 — process_ids whose underlying announcement has been
  // removed by a moderator. Posts pointing at these are excluded from
  // the feed entirely. Distinct from processMeta because we need a
  // negative signal that survives the meta cache filling in with {}.
  const [removedProcessIds, setRemovedProcessIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getFeed()
      .then(({ events: all, processMeta: seeded }) => {
        if (cancelled) return;
        // Perf pass phase 2: the server batches every card's metadata
        // into the feed response, so cards render COMPLETE on the first
        // frame — the per-id lazy fetches below become a fallback for
        // any process the server couldn't enrich. Removed announcements
        // arrive as a flag on their meta entry.
        const removed = new Set<string>();
        const meta: Record<string, ProcessMeta> = {};
        for (const [id, m] of Object.entries(seeded)) {
          if (m.removed) removed.add(id);
          meta[id] = m;
        }
        if (removed.size > 0) setRemovedProcessIds(removed);
        setProcessMeta(meta);
        setEvents(all);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Slice 13 fix — pre-filter to events that produce a feed post before
  // applying the user-facing type filter or paginating. Phase 3 — the
  // feed-worthiness gate is now the single shared classifier; an event is
  // renderable iff classifyActivity returns non-null. Without this pre-filter,
  // non-renderable events (created/updated/aggregation_completed, etc.) count
  // against the PAGE_SIZE budget and can starve the visible window.
  const renderableEvents = useMemo(
    () => {
      const base = events.filter((e) => classifyActivity(e) !== null);
      return filter ? base.filter(filter) : base;
    },
    [events, filter],
  );

  const visibleEvents = useMemo(
    () => renderableEvents.slice(0, visibleCount),
    [renderableEvents, visibleCount],
  );

  // Fetch per-process metadata lazily for events visible in the feed. The
  // in-flight set is a ref so StrictMode's double-invoke doesn't double-fire
  // or cancel requests.
  const inFlight = useRef<Set<string>>(new Set());
  useEffect(() => {
    const needed: Array<{ id: string; kind: ActivityKind }> = [];
    for (const ev of visibleEvents) {
      const activity = classifyActivity(ev);
      if (!activity) continue;
      if (!ev.process_id) continue;
      if (ev.process_id in processMeta) continue;
      if (inFlight.current.has(ev.process_id)) continue;
      needed.push({ id: ev.process_id, kind: activity.kind });
    }
    if (needed.length === 0) return;

    for (const { id } of needed) inFlight.current.add(id);

    for (const { id, kind } of needed) {
      let lookup: Promise<ProcessMeta | null>;
      switch (kind) {
        case "vote-open":
          lookup = getProcessState(id).then((state) => {
            if (state.type !== "civic.vote") return null;
            const vote = state as VoteState;
            return {
              title: vote.title,
              description: vote.description,
              totalVotes: vote.total_votes ?? 0,
            };
          });
          break;
        case "vote-results":
          lookup = getPublicVoteResults(id).then((vr) => ({
            title: vr.title,
            description: vr.admin_notes ?? undefined,
            imageUrl: vr.image_url ?? null,
            imageAlt: vr.image_alt ?? null,
            totalVotes: vr.participation_count,
            commentsCount: vr.comments?.length ?? 0,
          }));
          break;
        case "meeting":
          lookup = getMeetingSummary(id).then((s) => {
            // The longest start_time_seconds across all blocks gives a
            // reasonable lower bound for meeting duration; videos still
            // run past the last marked topic, so this is "at least this
            // long" rather than exact. Acceptable for the engagement line.
            const starts = (s.blocks ?? [])
              .map((b) => b.start_time_seconds)
              .filter((n): n is number => typeof n === "number");
            const maxStart = starts.length > 0 ? Math.max(...starts) : null;
            return {
              title: s.meeting_title,
              description: undefined,
              blockCount: s.blocks?.length ?? 0,
              maxStartSeconds: maxStart,
            };
          });
          break;
        case "wordcloud":
          lookup = getWordcloud(id).then((wc) => ({
            title: wc.title,
            description: wc.description,
            totalVotes: wc.submission_count,
          }));
          break;
        case "project-created":
        case "project-updated":
          // Phase 3 fix — projects previously fell through to getAnnouncement(id)
          // and 404'd; fetch the real project detail (title + banner image).
          lookup = getProjectDetail(id).then((p) => ({
            title: p.title,
            description: p.description,
            imageUrl: p.banner_image_url ?? null,
            imageAlt: p.banner_image_alt ?? null,
          }));
          break;
        case "proposal":
        case "proposal-closed":
          // No fetch: resident proposals (prop_*) are not processes, so
          // /process/:id/state 404'd on every load — eight wasted
          // requests per feed (perf pass, 2026-08-28). The card renders
          // fully from the event payload (data.proposal.title).
          lookup = Promise.resolve({});
          break;
        case "conversation":
        case "conversation-results":
          // Polis conversations expose their subject as `topic`/`framing` in
          // the read model, not `title`/`description` — map them so the feed
          // card keeps the original conversation topic instead of falling
          // back to the literal "Conversation results".
          lookup = getProcessState(id).then((state) => {
            const s = state as unknown as Record<string, unknown>;
            return {
              title: (s.title ?? s.topic) as string | undefined,
              description: (s.description ?? s.framing) as string | undefined,
            };
          });
          break;
        case "announcement":
        case "announcement-author":
          // body serves as the feed summary. Slice 11: when an admin has
          // removed the announcement, push its id into removedProcessIds so the
          // post-builder filter drops it. The presence of the removal still
          // cooperates with the meta cache (resolved to {}) so we don't refetch.
          lookup = getAnnouncement(id).then((a) => {
            if (a.moderation?.removed) {
              setRemovedProcessIds((prev) => {
                if (prev.has(id)) return prev;
                const next = new Set(prev);
                next.add(id);
                return next;
              });
              return null;
            }
            return {
              title: a.title,
              description: a.body,
              imageUrl: a.image_url ?? null,
              imageAlt: a.image_alt ?? null,
              editCount: a.edit_count ?? 0,
              lastEditedAt: a.last_edited_at ?? null,
            };
          });
          break;
        case "brief":
        case "brief-response":
          // Brief cards render entirely from their event (title + headline,
          // or title + response excerpt), so no fetch is needed — and we
          // deliberately do NOT call getProcessState here (it would expose
          // the brief's admin read model). Resolve empty so the render gate
          // passes.
          lookup = Promise.resolve({});
          break;
      }

      lookup
        .then((meta) => {
          if (meta) {
            setProcessMeta((prev) => ({ ...prev, [id]: meta }));
          } else {
            // Mark resolved-but-empty so we don't retry every re-render.
            setProcessMeta((prev) => ({ ...prev, [id]: {} }));
          }
        })
        .catch(() => {
          // Most commonly: vote-results not yet published (404). Cache as
          // empty so the post either skips rendering or shows a fallback.
          setProcessMeta((prev) => ({ ...prev, [id]: {} }));
        })
        .finally(() => {
          inFlight.current.delete(id);
        });
    }
  }, [visibleEvents, processMeta]);

  const posts: FeedPostView[] = useMemo(() => {
    const getTitle = (id: string) => processMeta[id]?.title;
    const getDescription = (id: string) => processMeta[id]?.description;
    const out: FeedPostView[] = [];
    for (const ev of visibleEvents) {
      // Slice 11 — drop posts whose underlying announcement has been
      // removed by a moderator. The lookup loop above populates
      // removedProcessIds; this is the second half of the filter.
      if (ev.process_id && removedProcessIds.has(ev.process_id)) continue;
      // Render gate (narrowed in the 2026-08-28 perf pass): only kinds
      // whose TITLE must be fetched still wait for metadata — everything
      // else carries its title in the event payload and paints on the
      // first frame, with engagement counts/images hydrating in as the
      // lazy fetches land. The old blanket gate held EVERY card back a
      // full extra roundtrip (1-2s on prod).
      const kind = classifyActivity(ev)?.kind;
      if (
        ev.process_id &&
        kind !== undefined &&
        TITLE_NEEDS_META.has(kind) &&
        !(ev.process_id in processMeta)
      ) {
        continue;
      }
      const post = eventToPost(ev, getDescription, getTitle);
      if (!post) continue;
      const meta = processMeta[ev.process_id];
      out.push({
        ...post,
        imageUrl: meta?.imageUrl ?? null,
        imageAlt: meta?.imageAlt ?? null,
        // An event-derived line from eventToPost (e.g. the official-response
        // context) wins; buildEngagement only knows the fetched meta.
        engagement:
          post.engagement ?? (meta ? buildEngagement(post.pillKind, meta) : null),
      });
    }
    return out;
  }, [visibleEvents, processMeta, removedProcessIds]);

  const hasMore = renderableEvents.length > visibleCount;

  if (loading) {
    return (
      <section className="feed" aria-busy="true">
        <p className="feed-status">Loading feed…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="feed">
        <p className="feed-status feed-status-error">
          Could not load the feed: {error}
        </p>
      </section>
    );
  }

  if (posts.length === 0) {
    // Distinguish "feed is empty" from "filter matched nothing". The
    // first is the bootstrap state for a fresh hub; the second is a
    // resident's filter selection finding zero posts. The reset action
    // is provided by the parent (Home.tsx) when a filter is active.
    if (emptyFilteredAction && events.length > 0) {
      return (
        <section className="feed">
          <p className="feed-status">
            No posts match this filter yet.{" "}
          </p>
          <div className="feed-load-more-row">
            <button
              type="button"
              className="feed-load-more"
              onClick={emptyFilteredAction.onClick}
            >
              {emptyFilteredAction.label}
            </button>
          </div>
        </section>
      );
    }
    return (
      <section className="feed">
        <p className="feed-status">
          {hub.jurisdiction}'s civic feed is just getting started. Visit{" "}
          <Link to="/about">About</Link> to learn how this hub works.
        </p>
      </section>
    );
  }

  return (
    <section className="feed" aria-label="Civic activity feed">
      <ol className="feed-list">
        {posts.map((post) => (
          <li key={post.id} className="feed-list-item">
            <FeedPost post={post} />
          </li>
        ))}
      </ol>
      {hasMore && (
        <div className="feed-load-more-row">
          <button
            type="button"
            className="feed-load-more"
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          >
            Load more
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Kinds whose card title comes from the fetched read model rather than
 * the event payload — these still wait for metadata so they never flash
 * "Untitled vote". Everything else renders immediately.
 */
const TITLE_NEEDS_META: ReadonlySet<ActivityKind> = new Set([
  "vote-open",
  "vote-results",
  "wordcloud",
  "conversation-results",
  "proposal-closed",
  "project-updated",
] as ActivityKind[]);

/**
 * Slice 10 — compose the per-card engagement / metadata line from the
 * fields the Feed container fetched lazily for this process. Returns
 * null whenever no real signal exists for the post type, so the line
 * is suppressed entirely (no "0 residents voted" cards).
 *
 * Plural/singular handling lives here to keep FeedPost rendering dumb.
 */
function buildEngagement(
  kind: FeedPillKind,
  meta: ProcessMeta,
): string | null {
  switch (kind) {
    case "vote-open": {
      const n = meta.totalVotes ?? 0;
      if (n === 0) return "Open for input — be the first to vote";
      const noun = n === 1 ? "resident has" : "residents have";
      return `${formatCount(n)} ${noun} voted so far`;
    }
    case "vote-results": {
      const n = meta.totalVotes ?? 0;
      const m = meta.commentsCount ?? 0;
      if (n === 0 && m === 0) return null;
      const parts: string[] = [];
      if (n > 0) {
        const noun = n === 1 ? "resident" : "residents";
        parts.push(`${formatCount(n)} ${noun} voted`);
      }
      if (m > 0) {
        const noun = m === 1 ? "comment" : "comments";
        parts.push(`${formatCount(m)} ${noun}`);
      }
      return parts.join(" · ");
    }
    case "announcement":
    case "announcement-author": {
      const c = meta.editCount ?? 0;
      if (c > 0 && meta.lastEditedAt) {
        return `Edited ${relativeTime(meta.lastEditedAt)}`;
      }
      return null;
    }
    case "meeting": {
      const b = meta.blockCount ?? 0;
      if (b === 0) return null;
      const noun = b === 1 ? "topic" : "topics";
      const parts = [`${formatCount(b)} ${noun} covered`];
      const dur = formatDuration(meta.maxStartSeconds ?? null);
      if (dur) parts.push(dur);
      return parts.join(" · ");
    }
    case "wordcloud": {
      const n = meta.totalVotes ?? 0;
      if (n === 0) return "Share what's on your mind — be the first to respond";
      const noun = n === 1 ? "response" : "responses";
      return `${formatCount(n)} ${noun} so far`;
    }
    case "proposal":
    case "proposal-closed":
    case "project-created":
    case "project-updated":
    case "conversation":
    case "conversation-results":
    case "brief":
    case "brief-response":
      return null;
  }
}

/** "1234" → "1.2k". Below 1000 returns the integer untouched. */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  // 1.2k, 1.5k, 12k — one decimal under 10k, rounded otherwise.
  if (k < 10) return `${k.toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(k)}k`;
}

/**
 * Convert a max-block-start in seconds to a coarse duration label
 * ("12 min", "1h 5m"). Returns null when input is null / invalid.
 * "At least this long" — actual videos run past the last marked topic.
 */
function formatDuration(startSeconds: number | null): string | null {
  if (startSeconds == null || !Number.isFinite(startSeconds) || startSeconds <= 0) {
    return null;
  }
  const minutes = Math.max(1, Math.ceil(startSeconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes - h * 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
