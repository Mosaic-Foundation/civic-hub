import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { DeliberationSummary } from "../services/api";
import {
  listDeliberations,
} from "../services/api";
import HubInfo from "../components/HubInfo";
import ProcessPicker from "../components/ProcessPicker";
import AuthModal from "../components/AuthModal";
import { useRequireAuth } from "../hooks/useRequireAuth";
import StatusFilter, { useStatusFilter } from "../components/StatusFilter";
import { statusDisplay } from "../components/statusDisplay";
import "./Deliberations.css";
import { typeColorSlug } from "../components/typeColor";
import { friendlyType } from "../components/ProcessLinkPicker";

const FILTER_CHOICES = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
] as const;

export default function Deliberations() {
  // CTA-gate (design decision 2026-08-28): the create buttons are
  // visible to everyone, but clicking one runs the sign-up gate first —
  // the picker opens only for signed-in residents. Direct /…/new URLs
  // keep the softer buffer-then-gate flow for shared links.
  const { requireAuth, showAuthModal, closeAuthModal, handleAuthComplete } =
    useRequireAuth();
  const { isAdmin } = useAuth();
  const [processes, setProcesses] = useState<DeliberationSummary[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const procs = await listDeliberations();
      setProcesses(procs);
    } catch {
      // no deliberations yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const active = processes.filter((p) => p.lifecycle === "active");
  const completed = processes.filter(
    (p) => p.lifecycle === "closed" || p.lifecycle === "finalized",
  );
  // Approved but not yet started — normally auto-start at approval makes
  // this transient, but when Polis was unreachable the conversation waits
  // here for a manual Start. Without this section it was stranded
  // invisibly: not active, not completed, no path to the Start button.
  const waiting = processes.filter((p) => p.lifecycle === "draft");

  const { active: filter, setActive: setFilter } = useStatusFilter(FILTER_CHOICES);
  const showActive = filter === "all" || filter === "active";
  const showCompleted = filter === "all" || filter === "completed";

  return (
    <div className="page page-home">
      <HubInfo />
      {showAuthModal && (
        <AuthModal onComplete={handleAuthComplete} onDismiss={closeAuthModal} />
      )}
      {showPicker && <ProcessPicker onDismiss={() => setShowPicker(false)} context="conversation" />}

      <section className="section">
        <div className="section-header-row">
          <div>
            <h2 className="section-title">Community Conversations</h2>
            <p className="section-description">
              Vote on statements and see where the community stands.
            </p>
          </div>
          <button type="button" className="home-start-btn" onClick={() => requireAuth(() => setShowPicker(true))}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Start a conversation
            </button>
        </div>
      </section>

      <StatusFilter
        choices={FILTER_CHOICES}
        active={filter}
        onChange={setFilter}
        label="Filter conversations by status"
      />

      {loading && <p className="section deliberations-loading">Loading...</p>}

      {/* Approved-but-unstarted conversations, admin-only: the door to the
          manual Start fallback when auto-start couldn't reach Polis. */}
      {!loading && isAdmin && waiting.length > 0 && (
        <section className="section">
          <h2 className="section-title">Waiting to start</h2>
          <p className="section-description">
            Approved but not yet opened — start each one to create its live
            conversation.
          </p>
          <ul className="process-list">
            {waiting.map((p) => (
              <li key={p.process_id}>
                <Link to={`/deliberation/${p.process_id}`} className="process-link">
                  <div className="deliberation-card">
                    <div className="deliberation-card-header">
                      <span className={`feed-pill feed-pill--type-${typeColorSlug("civic.polis_deliberation")}`}>
                        {friendlyType("civic.polis_deliberation")}
                      </span>
                      <h3>{p.topic}</h3>
                    </div>
                    <div className="process-card-meta">
                      {p.created_at && (
                        <span>{new Date(p.created_at).toLocaleDateString()}</span>
                      )}
                      <span className={statusDisplay("draft").className}>
                        {statusDisplay("draft").label}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!loading && showActive && active.length > 0 && (
        <section className="section">
          <h2 className="section-title">Active Conversations</h2>
          <ul className="process-list">
            {active.map((p) => (
              <li key={p.process_id}>
                <Link to={`/deliberation/${p.process_id}`} className="process-link">
                  <div className="deliberation-card">
                    <div className="deliberation-card-header">
                      <span className={`feed-pill feed-pill--type-${typeColorSlug("civic.polis_deliberation")}`}>
                        {friendlyType("civic.polis_deliberation")}
                      </span>
                      <h3>{p.topic}</h3>
                    </div>
                    <div className="process-card-meta">
                      {p.created_at && (
                        <span>{new Date(p.created_at).toLocaleDateString()}</span>
                      )}
                      {(p.participant_count ?? 0) > 0 && (
                        <span>
                          {p.participant_count} participant{p.participant_count !== 1 ? "s" : ""}
                        </span>
                      )}
                      <span className={statusDisplay("active").className}>{statusDisplay("active").label}</span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!loading && showCompleted && completed.length > 0 && (
        <section className="section">
          <h2 className="section-title">Completed</h2>
          <ul className="process-list">
            {completed.map((p) => (
              <li key={p.process_id}>
                <Link to={`/deliberation/${p.process_id}`} className="process-link">
                  <div className="deliberation-card">
                    <div className="deliberation-card-header">
                      <span className={`feed-pill feed-pill--type-${typeColorSlug("civic.polis_deliberation")}`}>
                        {friendlyType("civic.polis_deliberation")}
                      </span>
                      <h3>{p.topic}</h3>
                    </div>
                    <div className="process-card-meta">
                      {p.created_at && (
                        <span>{new Date(p.created_at).toLocaleDateString()}</span>
                      )}
                      {(p.participant_count ?? 0) > 0 && (
                        <span>
                          {p.participant_count} participant{p.participant_count !== 1 ? "s" : ""}
                        </span>
                      )}
                      <span className={statusDisplay("completed").className}>{statusDisplay("completed").label}</span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!loading && processes.length === 0 && (
        <p className="section deliberations-empty">
          No conversations yet.
          {isAdmin ? " Create one to gather community perspectives." : ""}
        </p>
      )}
    </div>
  );
}
