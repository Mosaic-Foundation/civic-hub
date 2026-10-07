import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  search,
  type SearchHit,
  type SearchResultPage,
  type SearchSort,
  type SearchTypeKey,
} from "../services/api";
import SearchBar from "../components/SearchBar";
import { relativeTime, absoluteTime } from "../components/FeedPost";
import hub from "../config/hub";
import { processTypeShown } from "../config/plugins";
import { searchChipsShown } from "../config/pluginRules";
// FeedFilter.css carries the .feed-filter-pill--<kind> rules we
// reuse for the post-type filter row on this page. Imported here
// since Search doesn't render <FeedFilter> directly.
import "../components/FeedFilter.css";
import "./Search.css";

/**
 * Slice 10.5 — search results page.
 *
 * URL is the source of truth for every filter / sort / page change.
 * The page reads its state from useSearchParams on mount and on every
 * URL change, fires a single fetch, and renders the result cards.
 *
 * Layout (top → bottom):
 *   1. Heading.
 *   2. Search input (pre-filled with q).
 *   3. Type filter pills (multi-select).
 *   4. Date-range pills (single-select bucket).
 *   5. Sort dropdown.
 *   6. Results / empty / no-query / loading state.
 *   7. Pagination.
 */

const PAGE_SIZE = 25;

const TYPE_CHOICES: ReadonlyArray<{
  key: SearchTypeKey;
  label: string;
  pillClass: string;
}> = [
  { key: "vote", label: "Votes", pillClass: "feed-pill--vote-open" },
  { key: "announcement", label: "Announcements", pillClass: "feed-pill--announcement" },
  { key: "vote_results", label: "Vote results", pillClass: "feed-pill--vote-results" },
  {
    key: "meeting_summary",
    label: "Meeting summaries",
    pillClass: "feed-pill--meeting",
  },
];

type DateBucket = "any" | "week" | "month" | "year";

const DATE_CHOICES: ReadonlyArray<{ key: DateBucket; label: string }> = [
  { key: "any", label: "Any time" },
  { key: "week", label: "Past week" },
  { key: "month", label: "Past month" },
  { key: "year", label: "Past year" },
];

function dateBucketToFrom(bucket: DateBucket): string | null {
  if (bucket === "any") return null;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const ms =
    bucket === "week" ? 7 * day : bucket === "month" ? 30 * day : 365 * day;
  return new Date(now - ms).toISOString();
}

function fromIsoToBucket(from: string | null): DateBucket {
  if (!from) return "any";
  const ms = Date.now() - new Date(from).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (ms <= 7.5 * day) return "week";
  if (ms <= 35 * day) return "month";
  return "year";
}

const TYPE_PILL_LABELS: Record<string, string> = {
  "civic.vote": "Vote",
  "civic.vote_results": "Vote results",
  "civic.announcement": "Announcement",
  "civic.meeting_summary": "Meeting summary",
};

const TYPE_PILL_CLASSES: Record<string, string> = {
  "civic.vote": "feed-pill--vote-open",
  "civic.vote_results": "feed-pill--vote-results",
  "civic.announcement": "feed-pill--announcement",
  "civic.meeting_summary": "feed-pill--meeting",
};

export default function SearchPage() {
  const [params, setParams] = useSearchParams();

  const q = params.get("q") ?? "";
  const types = params.getAll("type").filter(isTypeKey);
  const sort: SearchSort = params.get("sort") === "newest" ? "newest" : "relevance";
  const offsetRaw = parseInt(params.get("offset") ?? "0", 10);
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
  const from = params.get("from");

  const dateBucket: DateBucket = fromIsoToBucket(from);

  const [page, setPage] = useState<SearchResultPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refetch whenever the URL params change. The dep list is the
  // serialized search; React Router gives us a stable params object
  // per render but the values matter, not the reference.
  const fetchKey = useMemo(
    () =>
      JSON.stringify({
        q,
        types: [...types].sort(),
        sort,
        offset,
        from,
      }),
    [q, types, sort, offset, from],
  );

  useEffect(() => {
    let cancelled = false;
    if (q.trim().length === 0) {
      setPage(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    search({
      q,
      types: types.length > 0 ? types : undefined,
      sort,
      from: from ?? undefined,
      limit: PAGE_SIZE,
      offset,
    })
      .then((p) => {
        if (cancelled) return;
        setPage(p);
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
    // We deliberately depend on the serialized fetchKey so the hook
    // re-runs only when relevant inputs actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  function updateParam(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params);
    mutate(next);
    // Always reset offset on any non-pagination change so the user
    // doesn't land on page 5 of zero results after switching filters.
    if (!next.has("offset")) {
      // no-op
    }
    setParams(next, { replace: true });
  }

  function toggleType(key: SearchTypeKey) {
    updateParam((next) => {
      const current = next.getAll("type");
      next.delete("type");
      if (current.includes(key)) {
        for (const c of current) if (c !== key) next.append("type", c);
      } else {
        for (const c of current) next.append("type", c);
        next.append("type", key);
      }
      next.delete("offset");
    });
  }

  function setDateBucket(bucket: DateBucket) {
    updateParam((next) => {
      const fromIso = dateBucketToFrom(bucket);
      if (fromIso) {
        next.set("from", fromIso);
      } else {
        next.delete("from");
      }
      next.delete("to");
      next.delete("offset");
    });
  }

  function setSortValue(value: SearchSort) {
    updateParam((next) => {
      if (value === "relevance") next.delete("sort");
      else next.set("sort", value);
      next.delete("offset");
    });
  }

  function resetFilters() {
    updateParam((next) => {
      next.delete("type");
      next.delete("from");
      next.delete("to");
      next.delete("sort");
      next.delete("offset");
    });
  }

  function goToOffset(o: number) {
    updateParam((next) => {
      if (o <= 0) next.delete("offset");
      else next.set("offset", String(o));
    });
  }

  // --- Rendering ----------------------------------------------------

  return (
    <div className="page search-page">

      <header className="search-page-header">
        <h1>
          {q ? <>Search results for <em>{q}</em></> : `Search ${hub.name}`}
        </h1>
        <div className="search-page-input">
          <SearchBar inDrawer initialValue={q} />
        </div>
      </header>

      <section className="search-page-filters" aria-label="Refine results">
        <div className="search-page-filter-row">
          <button
            type="button"
            className={`feed-filter-pill feed-filter-pill--all ${types.length === 0 ? "is-active" : ""}`}
            onClick={() => updateParam((n) => { n.delete("type"); n.delete("offset"); })}
            aria-pressed={types.length === 0}
          >
            All types
          </button>
          {/* Only types this hub shows: a switched-off plugin's chip is gone
              (the server leaves its type out of every search anyway). */}
          {searchChipsShown(TYPE_CHOICES, processTypeShown).map((choice) => {
            const active = types.includes(choice.key);
            const cls = [
              "feed-filter-pill",
              choice.pillClass.replace("feed-pill--", "feed-filter-pill--"),
              active ? "is-active" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={choice.key}
                type="button"
                className={cls}
                onClick={() => toggleType(choice.key)}
                aria-pressed={active}
              >
                {choice.label}
              </button>
            );
          })}
        </div>

        <div className="search-page-filter-row">
          {DATE_CHOICES.map((choice) => {
            const active = choice.key === dateBucket;
            const cls = `search-page-date-pill${active ? " is-active" : ""}`;
            return (
              <button
                key={choice.key}
                type="button"
                className={cls}
                onClick={() => setDateBucket(choice.key)}
                aria-pressed={active}
              >
                {choice.label}
              </button>
            );
          })}

          <div className="search-page-sort">
            <label htmlFor="search-sort" className="form-hint">Sort:</label>
            <select
              id="search-sort"
              value={sort}
              onChange={(e) => setSortValue(e.target.value as SearchSort)}
            >
              <option value="relevance">Relevance</option>
              <option value="newest">Newest first</option>
            </select>
          </div>
        </div>
      </section>

      <SearchBody
        q={q}
        loading={loading}
        error={error}
        page={page}
        offset={offset}
        onResetFilters={resetFilters}
        onGoToOffset={goToOffset}
      />
    </div>
  );
}

function isTypeKey(v: string): v is SearchTypeKey {
  return (
    v === "vote" ||
    v === "vote_results" ||
    v === "announcement" ||
    v === "meeting_summary"
  );
}

interface BodyProps {
  q: string;
  loading: boolean;
  error: string | null;
  page: SearchResultPage | null;
  offset: number;
  onResetFilters: () => void;
  onGoToOffset: (o: number) => void;
}

function SearchBody({
  q,
  loading,
  error,
  page,
  offset,
  onResetFilters,
  onGoToOffset,
}: BodyProps) {
  if (q.trim().length === 0) {
    return (
      <p className="search-page-status">
        Search every post on the Civic Hub. Try <em>fire ban</em>, <em>budget</em>,
        or a meeting date.
      </p>
    );
  }
  if (loading) {
    return <p className="search-page-status" aria-busy="true">Searching…</p>;
  }
  if (error) {
    return (
      <p className="search-page-status search-page-status-error">
        Could not load results: {error}
      </p>
    );
  }
  if (!page) {
    return null;
  }

  if (page.total === 0) {
    return (
      <div className="search-page-empty">
        <p>
          No results for <em>{q}</em>. Try a broader search, or remove some
          filters.
        </p>
        <button
          type="button"
          className="search-page-reset"
          onClick={onResetFilters}
        >
          Reset filters
        </button>
      </div>
    );
  }

  const start = offset + 1;
  const end = Math.min(offset + page.hits.length, page.total);
  const hasPrev = offset > 0;
  const hasNext = offset + page.hits.length < page.total;

  return (
    <>
      <p className="search-page-meta">
        Showing {start.toLocaleString()}–{end.toLocaleString()} of{" "}
        {page.total.toLocaleString()}
      </p>

      <ol className="search-page-list">
        {page.hits.map((hit) => (
          <li key={hit.process_id} className="search-page-list-item">
            <ResultCard hit={hit} />
          </li>
        ))}
      </ol>

      {(hasPrev || hasNext) && (
        <div className="search-page-pagination">
          <button
            type="button"
            disabled={!hasPrev}
            onClick={() => onGoToOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            ← Previous
          </button>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => onGoToOffset(offset + PAGE_SIZE)}
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}

function ResultCard({ hit }: { hit: SearchHit }) {
  const pillLabel = TYPE_PILL_LABELS[hit.type] ?? "Post";
  const pillClass = TYPE_PILL_CLASSES[hit.type] ?? "";
  return (
    <Link to={hit.href} className="search-page-card">
      <div className="search-page-card-head">
        <h2 className="search-page-card-title">{hit.title}</h2>
        <span className={`feed-pill ${pillClass}`}>{pillLabel}</span>
      </div>
      {hit.description && (
        <p className="search-page-card-summary">
          {truncate(hit.description, 240)}
        </p>
      )}
      <time
        className="search-page-card-time"
        dateTime={hit.created_at}
        title={absoluteTime(hit.created_at)}
      >
        {relativeTime(hit.created_at)}
      </time>
    </Link>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
