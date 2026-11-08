import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { Link } from "react-router-dom";
import {
  listCivicProposals,
  type CivicProposalSummary,
} from "../services/api";
import ProcessPicker from "../components/ProcessPicker";
import AuthModal from "../components/AuthModal";
import { useRequireAuth } from "../hooks/useRequireAuth";
import StatusFilter from "../components/StatusFilter";
import { useStatusFilter } from "../components/statusFilterState";
import "./Propose.css";
import ProcessListCard from "../components/ProcessListCard";
import { cardDate } from "../components/cardDate";
import { CardList, EmptyState, Group, Page, PageAction, PageHead } from "../kit";

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
  const { data, loading, error } = useApi<CivicProposalSummary[]>("/proposals", () => listCivicProposals(), {
    cache: true,
  });
  const proposals = data ?? [];
  const [showPicker, setShowPicker] = useState(false);

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
    <Page>
      {showAuthModal && (
        <AuthModal onComplete={handleAuthComplete} onDismiss={closeAuthModal} />
      )}
      {showPicker && <ProcessPicker onDismiss={() => setShowPicker(false)} context="proposal" />}

      {loading && <p className="section">Loading...</p>}
      {error && <p className="section error">Failed to load: {error.message}</p>}

      {!loading && !error && (
        <>
          <PageHead
        title="Community Proposals"
        lede={<>Ideas and concerns raised by community members.</>}
        action={<PageAction onClick={() => requireAuth(() => setShowPicker(true))}>Make a proposal</PageAction>}
      />

          <StatusFilter
            choices={FILTER_CHOICES}
            active={filter}
            onChange={setFilter}
            label="Filter proposals by status"
          />

          <section className="section">
            {!showActive ? null : activeProposals.length === 0 ? (
              <EmptyState>No proposals yet.</EmptyState>
            ) : (
              <CardList>
                {activeProposals.map((p) => (
                  <li key={p.id}>
                    <Link to={`/proposal/${p.id}`} className="process-link">
                      <ProcessListCard
                        processType="civic.proposal"
                        status="open"
                        title={p.title}
                        sample={Boolean(p.is_sample)}
                        meta={[
                          cardDate(p.created_at),
                          `${p.support_count} supporter${p.support_count !== 1 ? "s" : ""}`,
                          cardDate(p.closes_at) && `closes ${cardDate(p.closes_at)}`,
                        ]}
                      />
                    </Link>
                  </li>
                ))}
              </CardList>
            )}
          </section>

          {showCompleted && archivedProposals.length > 0 && (
            <Group heading="Past Proposals">
              <CardList>
                {archivedProposals.map((p) => (
                  <li key={p.id}>
                    <Link to={`/proposal/${p.id}`} className="process-link">
                      <ProcessListCard
                        processType="civic.proposal"
                        status={p.status}
                        title={p.title}
                        sample={Boolean(p.is_sample)}
                        meta={[
                          cardDate(p.created_at),
                          `${p.support_count} supporter${p.support_count !== 1 ? "s" : ""}`,
                          cardDate(p.closes_at) && `closed ${cardDate(p.closes_at)}`,
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
