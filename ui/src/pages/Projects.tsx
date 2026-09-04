import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listProjects, type ProjectSummary } from "../services/api";
import HubInfo from "../components/HubInfo";
import ProcessPicker from "../components/ProcessPicker";
import AuthModal from "../components/AuthModal";
import { useRequireAuth } from "../hooks/useRequireAuth";
import Creator from "../components/Creator";
import "./Projects.css";
import { statusDisplay } from "../components/statusDisplay";
import StatusFilter, { useStatusFilter } from "../components/StatusFilter";
import { typeColorSlug } from "../components/typeColor";
import { friendlyType } from "../components/ProcessLinkPicker";

const FILTER_CHOICES = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "archived", label: "Archived" },
] as const;

export default function Projects() {
  // CTA-gate (design decision 2026-08-28): the create buttons are
  // visible to everyone, but clicking one runs the sign-up gate first —
  // the picker opens only for signed-in residents. Direct /…/new URLs
  // keep the softer buffer-then-gate flow for shared links.
  const { requireAuth, showAuthModal, closeAuthModal, handleAuthComplete } =
    useRequireAuth();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    listProjects()
      .then((all) => setProjects(all))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const activeProjects = projects
    .filter((p) => p.status === "active")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const archivedProjects = projects
    .filter((p) => p.status === "archived")
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  const { active: filter, setActive: setFilter } = useStatusFilter(FILTER_CHOICES);
  const showActive = filter === "all" || filter === "active";
  const showArchived = filter === "all" || filter === "archived";

  return (
    <div className="page page-home">
      <HubInfo />
      {showAuthModal && (
        <AuthModal onComplete={handleAuthComplete} onDismiss={closeAuthModal} />
      )}
      {showPicker && <ProcessPicker onDismiss={() => setShowPicker(false)} context="project" />}

      {loading && <p className="section">Loading...</p>}
      {error && <p className="section error">Failed to load: {error}</p>}

      {!loading && !error && (
        <>
          <section className="section">
            <div className="section-header-row">
              <div>
                <h2 className="section-title">Community Projects</h2>
                <p className="section-description">
                  Projects and initiatives organized by community members.
                </p>
              </div>
              <button type="button" className="home-start-btn" onClick={() => requireAuth(() => setShowPicker(true))}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Begin a project
                </button>
            </div>
          </section>

          <StatusFilter
            choices={FILTER_CHOICES}
            active={filter}
            onChange={setFilter}
            label="Filter projects by status"
          />

          <section className="section">
            {!showActive ? null : activeProjects.length === 0 ? (
              <p className="empty-state-inline">
                No projects yet.
              </p>
            ) : (
              <ul className="process-list">
                {activeProjects.map((p) => (
                  <li key={p.id}>
                    <Link to={`/project/${p.id}`} className="process-link">
                      <div className="project-card">
                        <div className="project-card-header">
                          <span className={`feed-pill feed-pill--type-${typeColorSlug("civic.project")}`}>
                            {friendlyType("civic.project")}
                          </span>
                          <h3>{p.title}</h3>
                        </div>
                        {(p.support_count > 0 || p.oppose_count > 0) && (
                          <div className="project-sentiment-bar">
                            {p.support_count > 0 && (
                              <span className="sentiment-support">
                                {p.support_count} support
                              </span>
                            )}
                            {p.oppose_count > 0 && (
                              <span className="sentiment-oppose">
                                {p.oppose_count} oppose
                              </span>
                            )}
                          </div>
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
                          <span className={statusDisplay("active").className}>{statusDisplay("active").label}</span>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {showArchived && archivedProjects.length > 0 && (
            <section className="section">
              <h2 className="section-title">Archived Projects</h2>
              <ul className="process-list">
                {archivedProjects.map((p) => (
                  <li key={p.id}>
                    <Link to={`/project/${p.id}`} className="process-link">
                      <div className="project-card">
                        <div className="project-card-header">
                          <span className={`feed-pill feed-pill--type-${typeColorSlug("civic.project")}`}>
                            {friendlyType("civic.project")}
                          </span>
                          <h3>{p.title}</h3>
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
                          <span className={statusDisplay("archived").className}>{statusDisplay("archived").label}</span>
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
