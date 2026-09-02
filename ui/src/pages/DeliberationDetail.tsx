import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  getDeliberation,
  startDeliberation,
  type DeliberationReadModel,
} from "../services/api";
import DeliberationPanel from "../components/deliberation/DeliberationPanel";
import CompletedDeliberation from "../components/deliberation/CompletedDeliberation";
import { statusDisplay } from "../components/statusDisplay";
import ProcessHeader from "../components/ProcessHeader";
import ShareButton from "../components/ShareButton";
import SourceLinks from "../components/SourceLinks";
import RelatedProcesses from "../components/RelatedProcesses";
import "./DeliberationDetail.css";
import AdminArchiveButton from "../components/AdminArchiveButton";

export default function DeliberationDetail() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [process, setProcess] = useState<DeliberationReadModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Manual Start — the fallback when auto-start at approval couldn't reach
  // Polis (dev without a token, or an outage). Admin-only, draft-only.
  async function handleStart() {
    if (!id || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      await startDeliberation(id);
      await load();
    } catch (err) {
      setStartError(
        err instanceof Error ? err.message : "Could not start the conversation",
      );
    } finally {
      setStarting(false);
    }
  }

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const detail = await getDeliberation(id);
      setProcess(detail);
    } catch (err: any) {
      setError(err.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="section">Loading...</div>;
  if (error) return <div className="section error">Error: {error}</div>;
  if (!process) return <div className="section">Conversation not found</div>;

  const isActive = process.lifecycle === "active";
  const isCompleted = process.lifecycle === "closed" || process.lifecycle === "finalized";

  return (
    <div className="page deliberation-detail-page">
      <div className="process-share-row">
        <ShareButton
          title={process.topic}
          shareText={`Join the conversation: ${process.topic}`}
        />
      </div>

      <ProcessHeader
        type="civic.polis_deliberation"
        title={process.topic}
        status={
          isActive
            ? statusDisplay("active")
            : isCompleted
              ? statusDisplay("completed")
              : { ...statusDisplay("draft"), label: "Waiting to start" }
        }
      />

      {process.assistant_helped && (
        <p className="assistant-helped-label">Drafted with assistant help</p>
      )}


      {isActive && <DeliberationPanel processId={process.process_id} showTopic={false} />}
      {isCompleted && <CompletedDeliberation process={process} showTopic={false} />}

      {!isActive && !isCompleted && (
        <div className="deliberation-detail-draft">
          <p className="deliberation-framing">{process.framing}</p>
          <SourceLinks sources={process.sources ?? []} />
          <p className="deliberation-detail-status">
            This conversation hasn't started yet.
          </p>
          {isAdmin && (
            <>
              <button
                type="button"
                className="home-start-btn"
                onClick={handleStart}
                disabled={starting}
              >
                {starting ? "Starting…" : "Start conversation"}
              </button>
              {startError && <p className="error-text">{startError}</p>}
            </>
          )}
        </div>
      )}

      {/* Admin-only soft-remove. Renders nothing for everyone else. */}
      <AdminArchiveButton
        processId={process.process_id}
        itemLabel="conversation"
        onArchived={() => navigate("/deliberations")}
      />

      <RelatedProcesses
        processId={process.process_id}
        title={process.topic}
        description={process.framing}
      />
    </div>
  );
}
