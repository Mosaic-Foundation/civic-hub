import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import hub from "../config/hub";
import { useAuth } from "../context/AuthContext";
import {
  listProcesses,
  type ProcessSummary,
  type PublishedVoteResultsSummary,
  type VoteSummary,
} from "../services/api";
import HubInfo from "../components/HubInfo";
import ProcessPicker from "../components/ProcessPicker";
import ProcessCard from "../components/ProcessCard";
import StatusFilter from "../components/StatusFilter";

/**
 * Slice 12 — Votes-page filter pills mirror the home-feed pattern.
 *   all       — show every section
 *   active    — vote processes accepting input right now
 *   proposed  — community-submitted ideas gathering support
 *   finalized — closed / finalized votes (results page link if available)
 *
 * State is mirrored in the URL via `?status=` so a filtered view is
 * bookmarkable and survives refresh.
 */
type VotesFilterKey = "all" | "active" | "proposed" | "finalized";

// "finalized" stays the URL key (bookmarks survive); the LABEL is the
// shared vocabulary's "Completed" (statusDisplay.ts).
const FILTER_CHOICES: ReadonlyArray<{ key: VotesFilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "proposed", label: "Proposed" },
  { key: "finalized", label: "Completed" },
];

function isFilterKey(v: string | null): v is VotesFilterKey {
  return v === "active" || v === "proposed" || v === "finalized";
}

export default function Votes() {
  const { user } = useAuth();
  const [processes, setProcesses] = useState<ProcessSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const [params, setParams] = useSearchParams();
  const rawStatus = params.get("status");
  const activeFilter: VotesFilterKey = isFilterKey(rawStatus) ? rawStatus : "all";

  function setActiveFilter(next: VotesFilterKey) {
    const updated = new URLSearchParams(params);
    if (next === "all") updated.delete("status");
    else updated.set("status", next);
    setParams(updated, { replace: true });
  }

  useEffect(() => {
    listProcesses(["civic.vote"])
      .then(setProcesses)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const activeVotes = processes
    .filter((p): p is VoteSummary =>
      p.type === "civic.vote" && p.status === "active"
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const completedVotes = processes
    .filter((p): p is VoteSummary =>
      p.type === "civic.vote" &&
      (p.status === "closed" || p.status === "finalized")
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Index published vote-results by source vote id so completed-vote
  // cards can link to their results page in one lookup. Accepts the
  // legacy "civic.brief" type literal for unmigrated rows.
  const voteResultsByVote = useMemo(() => {
    const map = new Map<string, PublishedVoteResultsSummary>();
    for (const p of processes) {
      const t = (p as { type?: string }).type;
      if (t === "civic.vote_results" || t === "civic.brief") {
        map.set(
          (p as PublishedVoteResultsSummary).source_process_id,
          p as PublishedVoteResultsSummary,
        );
      }
    }
    return map;
  }, [processes]);

  const proposedVotes = processes
    .filter((p): p is VoteSummary =>
      p.type === "civic.vote" &&
      (p.status === "proposed" || p.status === "threshold_met" || p.status === "draft")
    )
    .sort((a, b) => b.support_count - a.support_count);

  // Idea-board proposals (civic.proposal) are NOT proposed votes — they live
  // on the Proposals tab (Propose.tsx), fetched from the dedicated proposals
  // API. The Votes page shows only civic.vote processes.
  const hasAnyProposals = proposedVotes.length > 0;

  // Section visibility — derived from the active filter.
  const showActive = activeFilter === "all" || activeFilter === "active";
  const showProposed = activeFilter === "all" || activeFilter === "proposed";
  const showFinalized = activeFilter === "all" || activeFilter === "finalized";

  return (
    <div className="page page-home">
      <HubInfo />
      {showPicker && <ProcessPicker onDismiss={() => setShowPicker(false)} context="vote" />}

      {/* Slice 12.1 — Feed | Votes tab strip. Sits below HubInfo so
          site identity reads first, then the user picks what surface
          they want. Same component on the Home page; the active
          state comes from the URL via NavLink. */}

      <section className="section">
        <div className="section-header-row">
          <div>
            <h2 className="section-title">Community Votes</h2>
            <p className="section-description">
              Official and proposed advisory votes for {hub.jurisdiction}.
            </p>
          </div>
          {user && (
            <button type="button" className="home-start-btn" onClick={() => setShowPicker(true)}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Suggest a vote
            </button>
          )}
        </div>
      </section>


      <StatusFilter
        choices={FILTER_CHOICES}
        active={activeFilter}
        onChange={(k) => setActiveFilter(k as VotesFilterKey)}
        label="Filter votes by status"
      />

      {loading && <p className="section">Loading...</p>}
      {error && <p className="section error">Failed to load: {error}</p>}

      {!loading && !error && (
        <>
          {showActive && (
            <section className="section">
              <h2 className="section-title">Active Votes</h2>
              {activeVotes.length === 0 ? (
                <p className="empty-state-inline">
                  {completedVotes.length === 0
                    ? "Nothing here yet. Come back soon — the first issues will launch shortly."
                    : "No active votes right now. When the Board asks for resident input, it'll show up here."}
                </p>
              ) : (
                <ul className="process-list">
                  {activeVotes.map((v) => (
                    <li key={v.id}>
                      <Link to={`/process/${v.id}`} className="process-link">
                        <ProcessCard process={v} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {showProposed && (
            <section className="section">
              <h2 className="section-title">Proposed Votes</h2>
              <p className="section-description">
                Ideas submitted by community members. Endorse the ones
                you care about to help them become official votes.
              </p>
              {!hasAnyProposals ? (
                <p className="empty-state-inline">
                  No proposals yet.
                </p>
              ) : (
                <ul className="process-list">
                  {proposedVotes.map((v) => (
                    <li key={v.id}>
                      <Link to={`/process/${v.id}`} className="process-link">
                        <ProcessCard process={v} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {showFinalized && (
            <section className="section">
              <h2 className="section-title">Completed Votes</h2>
              {completedVotes.length === 0 ? (
                <p className="empty-state-inline">No completed votes yet.</p>
              ) : (
                <ul className="process-list">
                  {completedVotes.map((v) => {
                    const results = voteResultsByVote.get(v.id);
                    return (
                      <li key={v.id}>
                        <div className="completed-vote-card">
                          <Link to={`/process/${v.id}`} className="process-link">
                            <ProcessCard process={v} />
                          </Link>
                          <div className="completed-vote-brief-row">
                            {results ? (
                              <Link to={`/vote-results/${results.id}`} className="brief-link">
                                View vote results &rarr;
                              </Link>
                            ) : (
                              <span className="brief-pending-chip">
                                Vote results pending review
                              </span>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
