import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { useParams, useNavigate } from "react-router-dom";
import { useAction } from "../hooks/useAction";
import { useAuth } from "../context/authState";
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
import ShareMoment from "../components/ShareMoment";
import SourceLinks from "../components/SourceLinks";
import RelatedProcesses from "../components/RelatedProcesses";
import DetailActions from "../components/DetailActions";
import { CloseEarlyButton, ClosedEarlyNote } from "../components/CloseEarly";
import { BriefPointer } from "../components/BriefPointer";
import "./DeliberationDetail.css";
import AdminArchiveButton from "../components/AdminArchiveButton";
import RichText from "../components/RichText";
import EditHistory from "../components/EditHistory";

export default function DeliberationDetail() {
  const [participatedState, setParticipated] = useState(false);
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { id } = useParams<{ id: string }>();
  // Back in view after a while: read it again (a second tab catches up).
  const {
    data: process,
    loading,
    error,
    reload,
    setData: setProcess,
  } = useApi<DeliberationReadModel>(id ? `deliberations/${id}` : null, () => getDeliberation(id!), {
    refreshOnVisible: true,
  });
  const start = useAction("Could not start the conversation. Please try again.");
  const starting = start.busy;
  const startError = start.error;

  // Manual Start — the fallback when auto-start at approval couldn't reach
  // Polis (dev without a token, or an outage). Admin-only, draft-only.
  function handleStart() {
    if (!id) return;
    return start.run(async () => {
      const answer = await startDeliberation(id);
      if (answer.view) setProcess(answer.view);
      else await reload();
    });
  }

  if (loading) return <div className="section">Loading...</div>;
  if (error) return <div className="section error">Error: {error.message}</div>;
  if (!process) return <div className="section">Conversation not found</div>;

  const participated = participatedState;
  const isActive = process.lifecycle === "active";
  const isCompleted = process.lifecycle === "closed" || process.lifecycle === "finalized";

  return (
    <div className="page deliberation-detail-page">
      <div className="process-share-row">
        <ShareButton
          title={process.topic}
          processId={process.process_id}
          shareText={`Join the conversation: ${process.topic}`}
        />
      </div>

      <ProcessHeader
        type="civic.polis_deliberation"
        title={process.topic}
        sample={Boolean(process.is_sample)}
        status={
          isActive
            ? statusDisplay("active")
            : isCompleted
              ? statusDisplay("completed")
              : { ...statusDisplay("draft"), label: "Waiting to start" }
        }
      />

      <BriefPointer processId={process.process_id} />

      {/* Closed before its deadline: the line and the admin's note. */}
      <ClosedEarlyNote closedEarly={process.closed_early} />

      {process.assistant_helped && (
        <p className="assistant-helped-label">Drafted with assistant help</p>
      )}


      {isActive && (
        <DeliberationPanel
          processId={process.process_id}
          showTopic={false}
          onParticipated={() => setParticipated(true)}
          // Rendered inside the panel, directly under the statement they are
          // voting on. Same threshold as before: three statement votes, or
          // one submitted statement.
          afterVoting={
            participated ? (
              <ShareMoment
                processId={process.process_id}
                text="Thanks for taking part — share this so more neighbors do."
                reveal="when-visible"
              />
            ) : null
          }
        />
      )}
      {isCompleted && <CompletedDeliberation process={process} showTopic={false} />}

      {!isActive && !isCompleted && (
        <div className="deliberation-detail-draft">
          <RichText className="deliberation-framing" text={process.framing} />
      <EditHistory processId={process.process_id} />
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
                aria-busy={starting}
              >
                {starting ? "Starting…" : "Start conversation"}
              </button>
              {startError && <p className="error-text">{startError}</p>}
            </>
          )}
        </div>
      )}

      <RelatedProcesses
        processId={process.process_id}
        title={process.topic}
        description={process.framing}
      />

      {/* Admin-only soft-remove, last thing on the page. */}
      <DetailActions>
        <CloseEarlyButton<DeliberationReadModel>
          processId={process.process_id}
          offer={process.early_close}
          noun="conversation"
          onView={(view) => (view ? setProcess(view) : void reload())}
        />
        <AdminArchiveButton
          processId={process.process_id}
          itemLabel="conversation"
          onArchived={() => navigate("/deliberations")}
        />
      </DetailActions>
    </div>
  );
}
