import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { Link } from "react-router-dom";
import { getOutcomes, type OutcomeEntry, type OutcomesPage } from "../services/api";
import { absoluteDate } from "../utils/dates";
import { friendlyType } from "../components/processLinkTypes";
import { useHub } from "../config/hub";
import "./Outcomes.css";
// The filter bar reuses the feed's pill classes so the two surfaces can
// never drift in style — see .feed-filter-pill--type-* in FeedFilter.css.
import "../components/FeedFilter.css";
import SampleBadge from "../components/SampleBadge";
import { briefColorSlug } from "../processes/display";
import { ListCard, Page, PageHead } from "../kit";

/**
 * Outcomes — the public archive of every completed civic process.
 *
 * The feed answers "what is happening"; this answers "what has this community
 * actually decided". A brief reachable only through the feed decays out of
 * view within days, and search only helps someone who already knows the words.
 * A permanent record needs a front door.
 *
 * Deliberately has no search box of its own: /search already indexes briefs,
 * and a second search here would drift from it. It links out instead.
 */

export default function Outcomes() {
  const hub = useHub();
  // Single-select, like the feed's filter bar: All, or exactly one type.
  // Always newest first — an archive reads backward from today; the old
  // sort dropdown was removed on purpose (Adam, 2026-08-28).
  const [type, setType] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);

  // Each filter is its own read, kept 30 seconds like the other list pages.
  const query = new URLSearchParams();
  if (type) query.append("source_type", type);
  if (year != null) query.set("year", String(year));
  const q = query.toString();
  const { data: page, loading, error } = useApi<OutcomesPage>(
    `/brief${q ? `?${q}` : ""}`,
    () => getOutcomes({ sourceTypes: type ? [type] : [], year }),
    { cache: true },
  );

  // Filter options come from the server, derived from what has actually been
  // published — so a process type added later appears here on its own. The
  // bar stays while the next filter loads.
  const [filters, setFilters] = useState<OutcomesPage["filters"] | undefined>(undefined);
  if (page && page.filters !== filters) setFilters(page.filters);
  const availableTypes = filters?.source_types ?? [];
  const availableYears = filters?.years ?? [];
  const filtered = type != null || year != null;

  return (
    <Page>
      {/* Same skeleton as Votes / Proposals / Projects / Conversations:
          .section blocks at the shared width. The hub's masthead is on Feed
          and About only (navigation polish, Adam, 2026-10-14): a section page
          opens at its own header. */}

      <PageHead
        title="Outcomes"
        lede={<>The permanent record of every completed process on the {hub.name} — what was decided, how many took part, and what it connects to.</>}
      />

      <section className="section">
      {availableTypes.length > 0 && (
        <div className="outcomes-filters" role="group" aria-label="Filter outcomes">
          {/* Same pill bar as the feed's filter — shared classes from
              FeedFilter.css, colored by the per-type tokens, single-select
              with "All" first. Only the types actually present in the
              archive get a pill. */}
          <div className="outcomes-filter-row">
            <button
              type="button"
              className={`feed-filter-pill feed-filter-pill--all${type === null ? " is-active" : ""}`}
              aria-pressed={type === null}
              onClick={() => setType(null)}
            >
              All
            </button>
            {availableTypes.map((t) => {
              const slug = typeSlug(t);
              const isActive = type === t;
              return (
                <button
                  key={t}
                  type="button"
                  className={`feed-filter-pill feed-filter-pill--type-${slug}${isActive ? " is-active" : ""}`}
                  aria-pressed={isActive}
                  onClick={() => setType(isActive ? null : t)}
                >
                  {friendlyType(t)}
                </button>
              );
            })}
          </div>

          <div className="outcomes-filter-row">
            {availableYears.length > 1 && (
              <label className="outcomes-select">
                <span>Year</span>
                <select
                  value={year ?? ""}
                  onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">All years</option>
                  {availableYears.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {filtered && (
              <button
                type="button"
                className="outcomes-clear"
                onClick={() => {
                  setType(null);
                  setYear(null);
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {loading && <p className="outcomes-status">Loading…</p>}
      {error && <p className="outcomes-status outcomes-status--error">{error.message}</p>}

      {!loading && !error && page && page.outcomes.length === 0 && (
        <p className="outcomes-status">
          {page.total_unfiltered === 0
            ? "No outcomes yet. When a vote or another process finishes, its result is published here for good."
            : "No outcomes match these filters."}
        </p>
      )}

      {!loading && page && page.outcomes.length > 0 && (
        <>
          <p className="outcomes-count">
            {page.total} outcome{page.total === 1 ? "" : "s"}
            {filtered && page.total_unfiltered !== page.total
              ? ` of ${page.total_unfiltered}`
              : ""}
          </p>
          <ul className="outcomes-list">
            {page.outcomes.map((o) => (
              <OutcomeRow key={o.id} outcome={o} />
            ))}
          </ul>
        </>
      )}
      </section>
    </Page>
  );
}


/**
 * Slug for the source process type, used to color a row: the colour its
 * manifest gives its Civic Brief (ui/src/processes/display.ts).
 *
 * The palette is the SAME one the feed uses (--pill-<slug>-* in theme.css), so
 * a proposal outcome here reads the same purple as a proposal card in the
 * feed. An unrecognized type falls back to a neutral slug rather than an
 * unstyled row — a process type registered later looks plain here, never
 * broken.
 */
const typeSlug = briefColorSlug;

function OutcomeRow({ outcome }: { outcome: OutcomeEntry }) {
  // THE shared card: the kit's ListCard (Events 3), the same one the
  // Votes/Proposals/Projects/Conversations lists render, so the archive
  // cannot drift from them again. No status here, so the kind's chip, the
  // Sample badge and the title stack (the card's header form); the accent is
  // the source process type's colour.
  return (
    <li className="outcomes-item">
      <ListCard
        href={`/brief/${outcome.id}`}
        linkAs={Link}
        kind={typeSlug(outcome.source_process_type)}
        kindLabel={friendlyType(outcome.source_process_type)}
        title={outcome.title}
        badges={outcome.is_sample ? <SampleBadge /> : undefined}
        meta={[
          <time dateTime={outcome.published_at}>{absoluteDate(outcome.published_at)}</time>,
          outcome.participation_label,
          outcome.related_count > 0 ? `${outcome.related_count} related` : null,
        ]}
      >
        <p className="outcomes-item-headline">{outcome.headline}</p>
      </ListCard>
    </li>
  );
}
