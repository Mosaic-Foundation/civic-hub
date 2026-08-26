import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getOutcomes, type OutcomeEntry, type OutcomesPage } from "../services/api";
import { friendlyType } from "../components/ProcessLinkPicker";
import hub from "../config/hub";
import "./Outcomes.css";

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

type Sort = "newest" | "oldest";

export default function Outcomes() {
  const [page, setPage] = useState<OutcomesPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [types, setTypes] = useState<string[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [sort, setSort] = useState<Sort>("newest");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPage(await getOutcomes({ sourceTypes: types, year, sort }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load outcomes.");
    } finally {
      setLoading(false);
    }
  }, [types, year, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleType(t: string) {
    setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }

  // Filter options come from the server, derived from what has actually been
  // published — so a process type added later appears here on its own.
  const availableTypes = page?.filters.source_types ?? [];
  const availableYears = page?.filters.years ?? [];
  const filtered = types.length > 0 || year != null;

  return (
    <div className="page outcomes-page">
      <header className="outcomes-header">
        <h1>Outcomes</h1>
        <p className="outcomes-intro">
          The permanent record of every completed process on the {hub.name} —
          what was decided, how many took part, and what it connects to.
        </p>
      </header>

      {availableTypes.length > 0 && (
        <div className="outcomes-filters" role="group" aria-label="Filter outcomes">
          <div className="outcomes-filter-row">
            {availableTypes.map((t) => (
              <button
                key={t}
                type="button"
                className={`outcomes-chip${types.includes(t) ? " is-on" : ""}`}
                aria-pressed={types.includes(t)}
                onClick={() => toggleType(t)}
              >
                {friendlyType(t)}
              </button>
            ))}
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

            <label className="outcomes-select">
              <span>Order</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </label>

            {filtered && (
              <button
                type="button"
                className="outcomes-clear"
                onClick={() => {
                  setTypes([]);
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
    <li className={`outcomes-item outcomes-item--${slug}`}>
      <Link to={`/brief/${outcome.id}`} className="outcomes-item-link">
        <div className="outcomes-item-head">
          <span className="outcomes-item-title">{outcome.title}</span>
          <span className={`outcomes-pill outcomes-pill--${slug}`}>
            {friendlyType(outcome.source_process_type)}
          </span>
        </div>
        <p className="outcomes-item-headline">{outcome.headline}</p>
        <p className="outcomes-item-meta">
          <time dateTime={outcome.published_at}>
            {published.toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
          {outcome.participation_label && <> · {outcome.participation_label}</>}
          {outcome.related_count > 0 && (
            <> · {outcome.related_count} related</>
          )}
        </p>
      </Link>
    </li>
  );
}
