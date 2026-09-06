import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { getOutcomes, type OutcomeEntry, type OutcomesPage } from "../services/api";
import { friendlyType } from "../components/ProcessLinkPicker";
import hub from "../config/hub";
import HubInfo from "../components/HubInfo";
import "./Outcomes.css";
// The filter bar reuses the feed's pill classes so the two surfaces can
// never drift in style — see .feed-filter-pill--type-* in FeedFilter.css.
import "../components/FeedFilter.css";

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
  const [page, setPage] = useState<OutcomesPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Single-select, like the feed's filter bar: All, or exactly one type.
  // Always newest first — an archive reads backward from today; the old
  // sort dropdown was removed on purpose (Adam, 2026-08-28).
  const [type, setType] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPage(await getOutcomes({ sourceTypes: type ? [type] : [], year }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load outcomes.");
    } finally {
      setLoading(false);
    }
  }, [type, year]);

  useEffect(() => {
    void load();
  }, [load]);

  // Filter options come from the server, derived from what has actually been
  // published — so a process type added later appears here on its own.
  const availableTypes = page?.filters.source_types ?? [];
  const availableYears = page?.filters.years ?? [];
  const filtered = type != null || year != null;

  return (
    <div className="page page-home">
      {/* Same skeleton as Votes / Proposals / Projects / Conversations: the
          county block first, then .section blocks at the shared width. This
          page used to render its own 780px header without HubInfo, so on a
          desktop it sat narrower than every neighbour and lost the county
          identity (Adam, 2026-09-06). */}
      <HubInfo />

      <section className="section">
        <div className="section-header-row">
          <div>
            <h2 className="section-title">Outcomes</h2>
            <p className="section-description">
              The permanent record of every completed process on the {hub.name} —
              what was decided, how many took part, and what it connects to.
            </p>
          </div>
        </div>
      </section>

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
      {error && <p className="outcomes-status outcomes-status--error">{error}</p>}

      {!loading && !error && page && page.outcomes.length === 0 && (
        <p className="outcomes-status">
          {page.total_unfiltered === 0
            ? "No processes have completed yet. When one does, its outcome is published here permanently."
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
    </div>
  );
}


/**
 * Slug for the source process type, used to color a row.
 *
 * The palette is the SAME one the feed uses (--pill-<slug>-* in theme.css), so
 * a proposal outcome here reads the same purple as a proposal card in the
 * feed. An unrecognized type falls back to a neutral slug rather than an
 * unstyled row — a process type registered later looks plain here, never
 * broken.
 */
function typeSlug(processType: string): string {
  switch (processType) {
    case "civic.vote":
      return "vote";
    case "civic.proposal":
      return "proposal";
    case "civic.polis_deliberation":
      return "conversation";
    case "civic.project":
      return "project";
    case "civic.wordcloud":
      return "wordcloud";
    default:
      return "generic";
  }
}

function OutcomeRow({ outcome }: { outcome: OutcomeEntry }) {
  const published = new Date(outcome.published_at);
  const slug = typeSlug(outcome.source_process_type);
  return (
    <li className="outcomes-item">
      {/* THE shared card language — literally the same classes the
          Votes/Proposals/Projects/Conversations lists render
          (.process-card + .process-card-header/meta in App.css), so the
          archive cannot drift from them again. Only the accent color is
          per-row: the source process type's --type-* token, passed as
          the card's own --card-accent custom property. */}
      <Link to={`/brief/${outcome.id}`} className="process-link">
        <div
          className="process-card"
          style={{ "--card-accent": `var(--type-${slug}-fg)` } as CSSProperties}
        >
          <div className="process-card-header">
            <span className={`feed-pill feed-pill--type-${slug}`}>
              {friendlyType(outcome.source_process_type)}
            </span>
            <h3>{outcome.title}</h3>
          </div>
          <p className="outcomes-item-headline">{outcome.headline}</p>
          <div className="process-card-meta">
            <time dateTime={outcome.published_at}>
              {published.toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </time>
            {outcome.participation_label && <span>{outcome.participation_label}</span>}
            {outcome.related_count > 0 && (
              <span>{outcome.related_count} related</span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}
