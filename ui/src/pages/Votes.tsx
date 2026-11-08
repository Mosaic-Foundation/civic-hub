import { useMemo, useState } from "react";
import { useApi } from "../hooks/useApi";
import { Link, useSearchParams } from "react-router-dom";
import { useHub } from "../config/hub";
import {
  listProcesses,
  type ProcessSummary,
  type PublishedVoteResultsSummary,
  type VoteSummary,
} from "../services/api";
import ProcessPicker from "../components/ProcessPicker";
import AuthModal from "../components/AuthModal";
import { useRequireAuth } from "../hooks/useRequireAuth";
import ProcessCard from "../components/ProcessCard";
import StatusFilter from "../components/StatusFilter";
import { CardList, EmptyState, Group, Page, PageAction, PageHead } from "../kit";

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

const NO_PROCESSES: ProcessSummary[] = [];

export default function Votes() {
  const hub = useHub();
  // CTA-gate (design decision 2026-08-28): the create buttons are
  // visible to everyone, but clicking one runs the sign-up gate first —
  // the picker opens only for signed-in residents. Direct /…/new URLs
  // keep the softer buffer-then-gate flow for shared links.
  const { requireAuth, showAuthModal, closeAuthModal, handleAuthComplete } =
    useRequireAuth();
  const { data, loading, error } = useApi<ProcessSummary[]>(
    "/process?type=civic.vote",
    () => listProcesses(["civic.vote"]),
    { cache: true },
  );
  const processes = data ?? NO_PROCESSES;
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
    <Page>
      {showAuthModal && (
        <AuthModal onComplete={handleAuthComplete} onDismiss={closeAuthModal} />
      )}
      {showPicker && <ProcessPicker onDismiss={() => setShowPicker(false)} context="vote" />}

      <PageHead
        title="Community Votes"
        lede={<>Official and proposed advisory votes for {hub.jurisdiction}.</>}
        action={<PageAction onClick={() => requireAuth(() => setShowPicker(true))}>Suggest a vote</PageAction>}
      />


      <StatusFilter
        choices={FILTER_CHOICES}
        active={activeFilter}
        onChange={(k) => setActiveFilter(k as VotesFilterKey)}
        label="Filter votes by status"
      />

      {loading && <p className="section">Loading...</p>}
      {error && <p className="section error">Failed to load: {error.message}</p>}

      {!loading && !error && (
        <>
          {showActive && (
            <Group heading="Active Votes">
              {activeVotes.length === 0 ? (
                <EmptyState>{completedVotes.length === 0
                    ? "No votes yet. When one opens, it will show up here."
                    : hub.governing_body_short
                      ? `No active votes right now. When the ${hub.governing_body_short} asks for input, it'll show up here.`
                      : "No active votes right now. New votes will show up here."}</EmptyState>
              ) : (
                <CardList>
                  {activeVotes.map((v) => (
                    <li key={v.id}>
                      <Link to={`/process/${v.id}`} className="process-link">
                        <ProcessCard process={v} />
                      </Link>
                    </li>
                  ))}
                </CardList>
              )}
            </Group>
          )}

          {showProposed && (
            <Group heading="Proposed Votes" description="Ideas submitted by community members. Endorse the ones you care about to help them become official votes.">
              {!hasAnyProposals ? (
                <EmptyState>No proposals yet.</EmptyState>
              ) : (
                <CardList>
                  {proposedVotes.map((v) => (
                    <li key={v.id}>
                      <Link to={`/process/${v.id}`} className="process-link">
                        <ProcessCard process={v} />
                      </Link>
                    </li>
                  ))}
                </CardList>
              )}
            </Group>
          )}

          {showFinalized && (
            <Group heading="Completed Votes">
              {completedVotes.length === 0 ? (
                <EmptyState>No completed votes yet.</EmptyState>
              ) : (
                <CardList>
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
                </CardList>
              )}
            </Group>
          )}
        </>
      )}
    </Page>
  );
}
