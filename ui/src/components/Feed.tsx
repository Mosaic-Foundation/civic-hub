import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHubConfig } from "../config/HubConfigContext";
import { getLoadedHubConfig } from "../config/hubConfig";
import { WireFeedReader } from "../services/wireFeed";
import { cachedRead } from "../hooks/useApi";
import { theName } from "../../../src/shared/hubCopy";
import { Link } from "react-router-dom";
import {
  type CivicEvent,
  type FeedProcessMeta,
  type FeedSurface,
  getFeed,
} from "../services/api";
import {
  classifyActivity,
  type ActivityKind,
} from "../../../src/shared/feedActivity";
import { feedKindUi } from "../processes";
import type { ProcessMeta } from "../processes/types";
import { processTypeEnabled } from "../config/plugins";
import FeedPost, {
  eventProcessType,
  eventToPost,
  type FeedPillKind,
  type FeedPostView,
} from "./FeedPost";
import hub from "../config/hub";
import "./Feed.css";

/**
 * Pages fetched in a row when one comes back empty but says more is older
 * (the server stops after scanning a stretch of the log). Past this, the
 * "Load more" button is left for the reader.
 */
const EMPTY_PAGE_RETRIES = 5;

/**
 * The "All" view reads the hub's public stream, /events (services/wireFeed.ts),
 * as an outside reader does. Carried on /api/feed: the filter pills (the
 * stream has no filter by surface) and a hub with any sample item (sample
 * content is never on the stream, ADR-010). `civic_feed_source=internal` in
 * sessionStorage reads /api/feed for this tab: the parity check's other half,
 * and a way back if the stream ever misreads.
 */
function readsStream(surface: FeedSurface | undefined): boolean {
  if (surface) return false;
  if (getLoadedHubConfig()?.content?.sample_items !== false) return false;
  try {
    return sessionStorage.getItem("civic_feed_source") !== "internal";
  } catch {
    return true;
  }
}

interface Props {
  /**
   * The filter pill in force (the URL's `?type=`), applied by the server
   * since the feed is paged there (2026-10-07). Undefined shows everything.
   */
  surface?: FeedSurface;
  /**
   * Slice 10 — when a filter is active and yields zero matches, render
   * a scoped empty state with this action (typically "Show all
   * activity" → reset). Pass `null` to suppress the action button
   * entirely (used when the active filter is "all" — caller never
   * passes the action in that case).
   */
  emptyFilteredAction?: { label: string; onClick: () => void } | null;
}

export default function Feed({ surface, emptyFilteredAction }: Props) {
  const [events, setEvents] = useState<CivicEvent[]>([]);
  const [processMeta, setProcessMeta] = useState<Record<string, ProcessMeta>>({});
  // Slice 11 — process_ids whose underlying announcement has been
  // removed by a moderator. Posts pointing at these are excluded from
  // the feed entirely. Distinct from processMeta because we need a
  // negative signal that survives the meta cache filling in with {}.
  const [removedProcessIds, setRemovedProcessIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Where the next (older) page starts; null once the oldest card is shown.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  // Bumped on every filter change, so a page that arrives for the old
  // filter is dropped.
  const generation = useRef(0);

  // One page of /api/feed, skipping over pages that came back empty.
  // Perf pass phase 2: the server batches every card's metadata into the
  // response (and /api/feed/meta into the stream's), so cards render
  // COMPLETE on the first frame — the per-id lazy fetches below become a
  // fallback for any process the server couldn't enrich. Removed
  // announcements arrive as a flag on their meta entry.
  const fetchInternalPage = useCallback(
    async (cursor: string | null) => {
      let page = await getFeed({ cursor, surface });
      for (let i = 0; page.events.length === 0 && page.nextCursor && i < EMPTY_PAGE_RETRIES; i++) {
        page = await getFeed({ cursor: page.nextCursor, surface });
      }
      return page;
    },
    [surface],
  );

  const stream = useRef<WireFeedReader | null>(null);
  const fetchPage = useCallback(
    async (cursor: string | null) => {
      if (readsStream(surface)) {
        // "Load more" continues the reader. A first page is kept 30 seconds
        // (useApi's cache), with a reader at the place it ends, so a hop back
        // to the feed is instant.
        if (cursor !== null && stream.current) {
          const page = await stream.current.page();
          return { events: page.events, processMeta: page.processMeta, nextCursor: page.done ? null : "stream" };
        }
        const first = await cachedRead("feed|stream", async () => {
          const reader = new WireFeedReader();
          return { page: await reader.page(), reader };
        });
        stream.current = first.reader.clone();
        const page = first.page;
        return { events: page.events, processMeta: page.processMeta, nextCursor: page.done ? null : "stream" };
      }
      stream.current = null;
      if (cursor === null) {
        return cachedRead(`feed|${surface ?? "all"}`, () => fetchInternalPage(null));
      }
      return fetchInternalPage(cursor);
    },
    [surface, fetchInternalPage],
  );

  const absorb = useCallback(
    (page: { events: CivicEvent[]; processMeta: Record<string, FeedProcessMeta>; nextCursor: string | null }, append: boolean) => {
      const removed: string[] = [];
      const meta: Record<string, ProcessMeta> = {};
      for (const [id, m] of Object.entries(page.processMeta)) {
        if (m.removed) removed.push(id);
        meta[id] = m;
      }
      if (removed.length > 0) {
        setRemovedProcessIds((prev) => new Set([...prev, ...removed]));
      }
      setProcessMeta((prev) => (append ? { ...prev, ...meta } : meta));
      setEvents((prev) => {
        if (!append) return page.events;
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...page.events.filter((e) => !seen.has(e.id))];
      });
      setNextCursor(page.nextCursor);
    },
    [],
  );

  useEffect(() => {
    const mine = ++generation.current;
    setLoading(true);
    setError(null);
    setMoreError(null);
    fetchPage(null)
      .then((page) => {
        if (mine !== generation.current) return;
        absorb(page, false);
      })
      .catch((err: Error) => {
        if (mine !== generation.current) return;
        setError(err.message);
      })
      .finally(() => {
        if (mine !== generation.current) return;
        setLoading(false);
      });
  }, [fetchPage, absorb]);

  function loadMore() {
    if (!nextCursor || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    setMoreError(null);
    fetchPage(nextCursor)
      .then((page) => {
        if (mine !== generation.current) return;
        absorb(page, true);
      })
      .catch((err: Error) => {
        if (mine !== generation.current) return;
        setMoreError(err.message);
      })
      .finally(() => {
        if (mine !== generation.current) return;
        setLoadingMore(false);
      });
  }

  // Load as you scroll (Adam, 2026-10-07): when the "Load more" row comes
  // within a screen of the viewport, the next page is fetched. The button
  // stays: for keyboard and screen-reader users, for a browser without
  // IntersectionObserver, and as the retry after a failed page (auto-loading
  // stops on an error so it cannot loop). The observer is rebuilt whenever a
  // load finishes, and a new observer reports at once whether the row is in
  // view, so a short page that leaves the row on screen fetches the next one.
  const sentinel = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const canAutoLoad = nextCursor !== null && !loadingMore && !moreError && !loading;
  useEffect(() => {
    const row = sentinel.current;
    if (!canAutoLoad || !row || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreRef.current();
      },
      { rootMargin: "0px 0px 800px 0px" },
    );
    observer.observe(row);
    return () => observer.disconnect();
  }, [canAutoLoad]);

  // The server sends only events that become cards; the classifier and the
  // plugin switch run again here because an admin's Settings save changes
  // the switches without a reload.
  const hubConfig = useHubConfig();
  const visibleEvents = useMemo(
    () =>
      events.filter(
        (e) =>
          classifyActivity(e) !== null &&
          // A switched-off plugin leaves the feed here: /events is the hub's
          // published record, which the server deliberately does not filter
          // by plugin (src/services/pluginGate.ts). A legacy event with no
          // type is left alone rather than hidden.
          (processTypeEnabled(eventProcessType(e) ?? "")),
      ),
    // hubConfig: processTypeEnabled() reads it from the module, so the lint
    // rule cannot see it; it changes when an admin's Settings save refreshes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, hubConfig],
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
      // Each kind fetches its own meta (ui/src/processes/); a kind with no
      // lookup has nothing to fetch.
      const lookup: Promise<ProcessMeta | null> =
        feedKindUi(kind)?.meta?.(id, {
          markRemoved: (removedId) =>
            setRemovedProcessIds((prev) => {
              if (prev.has(removedId)) return prev;
              const next = new Set(prev);
              next.add(removedId);
              return next;
            }),
        }) ?? Promise.resolve({});

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
        // Kinds whose card title comes from the fetched read model rather
        // than the event payload still wait for metadata, so they never flash
        // "Untitled vote".
        feedKindUi(kind)?.titleNeedsMeta &&
        !(ev.process_id in processMeta)
      ) {
        continue;
      }
      const post = eventToPost(ev, getDescription, getTitle);
      if (!post) continue;
      const meta = processMeta[ev.process_id];
      out.push({
        ...post,
        // A brief regenerated after it was published: the card is the same
        // one, showing the current headline (Actions slice).
        ...(kind === "brief" && meta?.description ? { summary: meta.description } : {}),
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

  const hasMore = nextCursor !== null;

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
    if (emptyFilteredAction) {
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
          {/* Not "<place, state>'s civic feed" (review R30): a hub's name
              reads on any kind of hub, with its article. */}
          The feed for {theName(hub.name)} is just getting started. Visit{" "}
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
      {moreError && (
        <p className="feed-status feed-status-error">
          Could not load more: {moreError}
        </p>
      )}
      {hasMore && (
        <div className="feed-load-more-row" ref={sentinel}>
          <button
            type="button"
            className="feed-load-more"
            onClick={loadMore}
            disabled={loadingMore}
            aria-busy={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Slice 10 — compose the per-card engagement / metadata line from the
 * fields the Feed container fetched lazily for this process. Each kind says
 * its own line (ui/src/processes/); null whenever no real signal exists for
 * the post type, so the line is suppressed entirely (no "0 residents voted"
 * cards).
 */
function buildEngagement(
  kind: FeedPillKind,
  meta: ProcessMeta,
): string | null {
  return feedKindUi(kind)?.engagement?.(meta) ?? null;
}
