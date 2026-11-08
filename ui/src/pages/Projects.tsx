import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { Link } from "react-router-dom";
import { listProjects, type ProjectSummary } from "../services/api";
import ProcessPicker from "../components/ProcessPicker";
import AuthModal from "../components/AuthModal";
import { useRequireAuth } from "../hooks/useRequireAuth";
import Creator from "../components/Creator";
import "./Projects.css";
import StatusFilter from "../components/StatusFilter";
import { useStatusFilter } from "../components/statusFilterState";
import ProcessListCard from "../components/ProcessListCard";
import { cardDate } from "../components/cardDate";
import { CardList, EmptyState, Group, Page, PageAction, PageHead } from "../kit";

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
  const { data, loading, error } = useApi<ProjectSummary[]>("/projects", () => listProjects(), { cache: true });
  const projects = data ?? [];
  const [showPicker, setShowPicker] = useState(false);

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
    <Page>
      {showAuthModal && (
        <AuthModal onComplete={handleAuthComplete} onDismiss={closeAuthModal} />
      )}
      {showPicker && <ProcessPicker onDismiss={() => setShowPicker(false)} context="project" />}

      {loading && <p className="section">Loading...</p>}
      {error && <p className="section error">Failed to load: {error.message}</p>}

      {!loading && !error && (
        <>
          <PageHead
        title="Community Projects"
        lede={<>Projects and initiatives organized by community members.</>}
        action={<PageAction onClick={() => requireAuth(() => setShowPicker(true))}>Begin a project</PageAction>}
      />

          <StatusFilter
            choices={FILTER_CHOICES}
            active={filter}
            onChange={setFilter}
            label="Filter projects by status"
          />

          <section className="section">
            {!showActive ? null : activeProjects.length === 0 ? (
              <EmptyState>No projects yet.</EmptyState>
            ) : (
              <CardList>
                {activeProjects.map((p) => (
                  <li key={p.id}>
                    <Link to={`/project/${p.id}`} className="process-link">
                      <ProcessListCard
                        processType="civic.project"
                        status="active"
                        title={p.title}
                        sample={Boolean(p.is_sample)}
                        meta={[
                          cardDate(p.created_at),
                          `${p.support_count} supporter${p.support_count !== 1 ? "s" : ""}`,
                          // Kept only when someone actually opposed: it is
                          // participation a resident entered, not noise.
                          p.oppose_count > 0 ? `${p.oppose_count} opposed` : null,
                          <Creator
                            name={p.creator_name}
                            isAdmin={p.creator_is_admin}
                            officialType={p.creator_official_type}
                            officialTitle={p.creator_official_title}
                            prefix="by"
                          />,
                        ]}
                      />
                    </Link>
                  </li>
                ))}
              </CardList>
            )}
          </section>

          {showArchived && archivedProjects.length > 0 && (
            <Group heading="Archived Projects">
              <CardList>
                {archivedProjects.map((p) => (
                  <li key={p.id}>
                    <Link to={`/project/${p.id}`} className="process-link">
                      <ProcessListCard
                        processType="civic.project"
                        status="archived"
                        title={p.title}
                        sample={Boolean(p.is_sample)}
                        meta={[
                          cardDate(p.created_at),
                          `${p.support_count} supporter${p.support_count !== 1 ? "s" : ""}`,
                          <Creator
                            name={p.creator_name}
                            isAdmin={p.creator_is_admin}
                            officialType={p.creator_official_type}
                            officialTitle={p.creator_official_title}
                            prefix="by"
                          />,
                        ]}
                      />
                    </Link>
                  </li>
                ))}
              </CardList>
            </Group>
          )}
        </>
      )}
    </Page>
  );
}
