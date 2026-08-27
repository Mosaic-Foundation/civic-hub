import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  listCivicProposals,
  type CivicProposalSummary,
} from "../services/api";
import HubInfo from "../components/HubInfo";
import ProcessPicker from "../components/ProcessPicker";
import Creator from "../components/Creator";
import "./Propose.css";

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
  const { user } = useAuth();
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

  return (
    <div className="page page-home">
      <HubInfo />
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
              {user && (
                <button type="button" className="home-start-btn" onClick={() => setShowPicker(true)}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Make a proposal
                </button>
              )}
            </div>
            {activeProposals.length === 0 ? (
              <p className="empty-state-inline">
                No proposals yet.
              </p>
            ) : (
              <ul className="process-list">
                {activeProposals.map((p) => (
                  <li key={p.id}>
                    <Link to={`/proposal/${p.id}`} className="process-link">
                      <div className="proposal-card">
                        <div className="proposal-card-header">
                          <h3>{p.title}</h3>
                          <span className="status-badge status-open">open</span>
                        </div>
                        {p.support_count > 0 && (
                          <p className="proposal-supporters">
                            {p.support_count}{" "}
                            {p.support_count === 1 ? "supporter" : "supporters"}
                          </p>
                        )}
                        <div className="process-card-meta">
                          <Creator
                            name={p.creator_name}
                            isAdmin={p.creator_is_admin}
                            officialType={p.creator_official_type}
                            officialTitle={p.creator_official_title}
                            prefix="by"
                          />
                          <span>{new Date(p.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {archivedProposals.length > 0 && (
            <section className="section">
              <h2 className="section-title">Past Proposals</h2>
              <ul className="process-list">
                {archivedProposals.map((p) => (
                  <li key={p.id}>
                    <Link to={`/proposal/${p.id}`} className="process-link">
                      <div className="proposal-card">
                        <div className="proposal-card-header">
                          <h3>{p.title}</h3>
                          <span className={`status-badge ${
                            p.status === "endorsed" ? "admin-status-endorsed" :
                            p.status === "converted" ? "status-converted" :
                            "status-archived"
                          }`}>
                            {p.status}
                          </span>
                        </div>
                        <div className="process-card-meta">
                          <Creator
                            name={p.creator_name}
                            isAdmin={p.creator_is_admin}
                            officialType={p.creator_official_type}
                            officialTitle={p.creator_official_title}
                            prefix="by"
                          />
                          <span>{new Date(p.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
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
