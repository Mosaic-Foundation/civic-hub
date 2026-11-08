import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { Link } from "react-router-dom";
import { useAuth } from "../context/authState";
import type { DeliberationSummary } from "../services/api";
import {
  listDeliberations,
} from "../services/api";
import ProcessPicker from "../components/ProcessPicker";
import AuthModal from "../components/AuthModal";
import { useRequireAuth } from "../hooks/useRequireAuth";
import StatusFilter from "../components/StatusFilter";
import { useStatusFilter } from "../components/statusFilterState";
import "./Deliberations.css";
import ProcessListCard from "../components/ProcessListCard";
import { cardDate } from "../components/cardDate";
import { CardList, Group, Page, PageAction, PageHead } from "../kit";

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
  const [showPicker, setShowPicker] = useState(false);
  // No conversations yet, or the read failed: the empty state.
  const { data, loading } = useApi<DeliberationSummary[]>("/deliberations", () => listDeliberations(), {
    cache: true,
  });
  const processes = data ?? [];

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
    <Page>
      {showAuthModal && (
        <AuthModal onComplete={handleAuthComplete} onDismiss={closeAuthModal} />
      )}
      {showPicker && <ProcessPicker onDismiss={() => setShowPicker(false)} context="conversation" />}

      <PageHead
        title="Community Conversations"
        lede={<>Vote on statements and see where the community stands.</>}
        action={<PageAction onClick={() => requireAuth(() => setShowPicker(true))}>Start a conversation</PageAction>}
      />

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
        <Group heading="Waiting to start" description="Approved but not yet opened — start each one to create its live conversation.">
          <CardList>
            {waiting.map((p) => (
              <li key={p.process_id}>
                <Link to={`/deliberation/${p.process_id}`} className="process-link">
                    <ProcessListCard
                      processType="civic.polis_deliberation"
                      status="draft"
                      title={p.topic}
                      sample={Boolean(p.is_sample)}
                      meta={[
                        cardDate(p.created_at),
                        (p.participant_count ?? 0) > 0
                          ? `${p.participant_count} participant${p.participant_count !== 1 ? "s" : ""}`
                          : null,
                        cardDate(p.deadline) && `closes ${cardDate(p.deadline)}`,
                      ]}
                    />
                </Link>
              </li>
            ))}
          </CardList>
        </Group>
      )}

      {!loading && showActive && active.length > 0 && (
        <Group heading="Active Conversations">
          <CardList>
            {active.map((p) => (
              <li key={p.process_id}>
                <Link to={`/deliberation/${p.process_id}`} className="process-link">
                    <ProcessListCard
                      processType="civic.polis_deliberation"
                      status="active"
                      title={p.topic}
                      sample={Boolean(p.is_sample)}
                      meta={[
                        cardDate(p.created_at),
                        (p.participant_count ?? 0) > 0
                          ? `${p.participant_count} participant${p.participant_count !== 1 ? "s" : ""}`
                          : null,
                        cardDate(p.deadline) && `closes ${cardDate(p.deadline)}`,
                      ]}
                    />
                </Link>
              </li>
            ))}
          </CardList>
        </Group>
      )}

      {!loading && showCompleted && completed.length > 0 && (
        <Group heading="Completed">
          <CardList>
            {completed.map((p) => (
              <li key={p.process_id}>
                <Link to={`/deliberation/${p.process_id}`} className="process-link">
                    <ProcessListCard
                      processType="civic.polis_deliberation"
                      status="completed"
                      title={p.topic}
                      sample={Boolean(p.is_sample)}
                      meta={[
                        cardDate(p.created_at),
                        (p.participant_count ?? 0) > 0
                          ? `${p.participant_count} participant${p.participant_count !== 1 ? "s" : ""}`
                          : null,
                        cardDate(p.deadline) && `closed ${cardDate(p.deadline)}`,
                      ]}
                    />
                </Link>
              </li>
            ))}
          </CardList>
        </Group>
      )}

      {!loading && processes.length === 0 && (
        <p className="section deliberations-empty">
          No conversations yet.
          {isAdmin ? " Create one to gather community perspectives." : ""}
        </p>
      )}
    </Page>
  );
}
