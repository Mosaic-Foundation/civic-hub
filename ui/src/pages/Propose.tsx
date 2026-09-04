import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  listCivicProposals,
  type CivicProposalSummary,
} from "../services/api";
import HubInfo from "../components/HubInfo";
import ProcessPicker from "../components/ProcessPicker";
import AuthModal from "../components/AuthModal";
import { useRequireAuth } from "../hooks/useRequireAuth";
import StatusFilter, { useStatusFilter } from "../components/StatusFilter";
import "./Propose.css";
import ProcessListCard, { cardDate } from "../components/ProcessListCard";

const FILTER_CHOICES = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
] as const;

/**
 * Slice B — Propose listing page. Mirrors the Votes page pattern:
 * hub banner + tab strip → CTA card → list of proposals.
 *
 * Proposals are standalone civic contributions — ideas and concerns
 * submitted by community members. Unlike the previous pipeline, they
 * are NOT a stepping stone to votes. They go live immediately after
 * the AI review gate.
 */
export default function Propose() {
  // CTA-gate (design decision 2026-08-28): the create buttons are
  // visible to everyone, but clicking one runs the sign-up gate first —
  // the picker opens only for signed-in residents. Direct /…/new URLs
  // keep the softer buffer-then-gate flow for shared links.
  const { requireAuth, showAuthModal, closeAuthModal, handleAuthComplete } =
    useRequireAuth();
  const [proposals, setProposals] = useState<CivicProposalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    listCivicProposals()
      .then((all) => setProposals(all))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Show submitted proposals, sorted by support count descending.
  // Endorsed/converted/archived proposals from before the Slice B
  // simplification still show if they exist — just lower in the list.
  const activeProposals = proposals
    .filter((p) => p.status === "submitted")
    .sort((a, b) => b.support_count - a.support_count);

  const archivedProposals = proposals
    .filter((p) => p.status !== "submitted")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const { active: filter, setActive: setFilter } = useStatusFilter(FILTER_CHOICES);
  const showActive = filter === "all" || filter === "active";
  const showCompleted = filter === "all" || filter === "completed";

  return (
    <div className="page page-home">
      <HubInfo />
      {showAuthModal && (
        <AuthModal onComplete={handleAuthComplete} onDismiss={closeAuthModal} />
      )}
      {showPicker && <ProcessPicker onDismiss={() => setShowPicker(false)} context="proposal" />}

      {loading && <p className="section">Loading...</p>}
      {error && <p className="section error">Failed to load: {error}</p>}

      {!loading && !error && (
        <>
          <section className="section">
            <div className="section-header-row">
              <div>
                <h2 className="section-title">Community Proposals</h2>
                <p className="section-description">
                  Ideas and concerns raised by community members.
                </p>
              </div>
              <button type="button" className="home-start-btn" onClick={() => requireAuth(() => setShowPicker(true))}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Make a proposal
                </button>
            </div>
          </section>

          <StatusFilter
            choices={FILTER_CHOICES}
            active={filter}
            onChange={setFilter}
            label="Filter proposals by status"
          />

          <section className="section">
            {!showActive ? null : activeProposals.length === 0 ? (
              <p className="empty-state-inline">
                No proposals yet.
              </p>
            ) : (
              <ul className="process-list">
                {activeProposals.map((p) => (
                  <li key={p.id}>
                    <Link to={`/proposal/${p.id}`} className="process-link">
                      <ProcessListCard
                        processType="civic.proposal"
                        status="open"
                        title={p.title}
                        meta={[
                          cardDate(p.created_at),
                          `${p.support_count} endorsement${p.support_count !== 1 ? "s" : ""}`,
                          cardDate(p.closes_at) && `closes ${cardDate(p.closes_at)}`,
                        ]}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {showCompleted && archivedProposals.length > 0 && (
            <section className="section">
              <h2 className="section-title">Past Proposals</h2>
              <ul className="process-list">
                {archivedProposals.map((p) => (
                  <li key={p.id}>
                    <Link to={`/proposal/${p.id}`} className="process-link">
                      <ProcessListCard
                        processType="civic.proposal"
                        status={p.status}
                        title={p.title}
                        meta={[
                          cardDate(p.created_at),
                          `${p.support_count} endorsement${p.support_count !== 1 ? "s" : ""}`,
                          cardDate(p.closes_at) && `closed ${cardDate(p.closes_at)}`,
                        ]}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
