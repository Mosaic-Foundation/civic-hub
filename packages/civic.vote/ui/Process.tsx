import { useParams, Navigate } from "react-router-dom";
import {
  AuthModal,
  BriefPointer,
  CloseEarlyButton,
  ClosedEarlyNote,
  CommentForm as ProposalCommentForm,
  CommunityInputPanel,
  Creator,
  DetailActions,
  EditHistory,
  PluginOff,
  ProcessHeader,
  RelatedProcesses,
  ResultsBreakdown,
  RichText,
  ShareButton,
  detailPathOf,
  formatDate,
  pluginOfType,
  statusDisplay,
  useApi,
  useRequireAuth,
  useSpace,
  useViewer,
} from "@civic-social/plugin-sdk/ui";
import { getProcessState, type ProcessState, type VoteState } from "./api";
import VotePanel from "./VotePanel";
import IssueContent from "./IssueContent";

export default function Process() {
  const space = useSpace();
  const { id } = useParams<{ id: string }>();
  const { actorId } = useViewer();
  const { showAuthModal, closeAuthModal, handleAuthComplete } = useRequireAuth();
  // actorId isn't read by the fetch, but a sign-in/out changes the Bearer
  // token request() sends: read again so has_voted reflects the new session.
  // Retries: a serverless cold start may need a moment.
  const {
    data: process,
    loading,
    error,
    reload,
    setData: setProcess,
  } = useApi<ProcessState>(id ? `process/${id}/state` : null, () => getProcessState(id!), {
    retries: 2,
    refreshOnVisible: true,
    rereadOn: actorId,
  });

  const currentActor = actorId ?? "anonymous";

  if (loading) return <p className="detail-page">Loading...</p>;
  if (error) return (
    <div className="page detail-page">
      <p className="error">Error: {error.message}</p>
      <button className="retry-button" onClick={() => void reload()}>
        Try again
      </button>
    </div>
  );
  if (!process) return (
    <div className="page detail-page">
      <p>Not found.</p>
    </div>
  );

  // This is the vote's page (its manifest's detailPath), and the kernel's
  // /process/:id link while Votes is on (the kernel's pages/ProcessLink.tsx).
  // Any other type has a page of its own: a proposal's is /proposal/:id, a
  // brief's /brief/:id; its own plugin is checked once the type is known.
  const path = detailPathOf(process.type, process.id);
  if (path !== `/process/${process.id}`) return <Navigate to={path} replace />;
  const plugin = pluginOfType(process.type);
  if (plugin && !space.pluginEnabled(plugin)) return <PluginOff />;

  const isVote = process.type === "civic.vote";
  const voteState = isVote ? (process as VoteState) : null;
  const hasContent = isVote && voteState?.content;

  return (
    <div className="page detail-page">
      {showAuthModal && (
        <AuthModal onComplete={handleAuthComplete} onDismiss={closeAuthModal} />
      )}

      <ProcessHeader
        type={process.type}
        title={process.title}
        status={statusDisplay(process.status)}
        sample={Boolean(process.is_sample)}
        // The jurisdiction code ("us-xx-example") is protocol data, not
        // something a visitor reads; its badge is gone (review R26).
      />

      <BriefPointer processId={process.id} />

      {/* Plain description (always shown) */}
      <RichText className="process-description" text={process.description} />
      <EditHistory processId={process.id} />

      <div className="process-meta">
        <Creator
          name={process.creator_name}
          isAdmin={process.creator_is_admin}
          officialType={process.creator_official_type}
          officialTitle={process.creator_official_title}
          prefix="Created by"
        />
        <span>Created {formatDate(process.created_at)}</span>
        {isVote && process.status === "active" && (process as VoteState).closes_at && (
          <span>Vote closes on {formatDate((process as VoteState).closes_at!)}</span>
        )}
        {isVote && process.status === "closed" && (process as VoteState).closes_at && (
          <span>Vote closed on {formatDate((process as VoteState).closes_at!)}</span>
        )}
        {isVote && process.status === "closed" && !(process as VoteState).closes_at && (
          <span>Voting closed</span>
        )}
        {isVote && process.status === "finalized" && <span>Voting finalized</span>}
      </div>

      {/* Closed before its deadline: the line and the admin's note. */}
      <ClosedEarlyNote closedEarly={voteState?.closed_early} />

      {/* Share — visible while the surface is gathering attention.
          Active votes (turn out the vote) + the proposal "gathering
          support" states. Suppressed once voting closes / a proposal
          archives — at that point sharing the URL no longer drives
          action. The link itself still works; users who really want
          to share can copy from the address bar. */}
      {isVote &&
        (process.status === "active" ||
          process.status === "proposed" ||
          process.status === "threshold_met") && (
        <div className="process-share-row">
          <ShareButton
            title={process.title}
            processId={process.id}
            shareText={`Vote on: ${process.title}`}
          />
        </div>
      )}

      {/* Structured issue content (only for processes with content) */}
      {hasContent && voteState?.content && (
        <IssueContent content={voteState.content} />
      )}

      {/* Vote/Proposal interaction panel — placed after issue content
          so residents read the context before acting. */}
      {isVote && (
        <VotePanel
          process={process as VoteState}
          actor={currentActor}
          onView={(view) => (view ? setProcess(view) : void reload())}
        />
      )}

      {/* Comment form for proposed processes (gathering support phase) */}
      {isVote && id && (process.status === "proposed" || process.status === "threshold_met") && (
        <ProposalCommentForm proposalId={id} />
      )}

      {/* Community comments */}
      {isVote && id && (
        <CommunityInputPanel
          processId={id}
          config={voteState?.content?.community_input}
        />
      )}

      {/* Finished: totals by district, age group, race (districts and demographics). */}
      {id && <ResultsBreakdown processId={id} />}

      {/* Related processes — universal panel. Renders both the links this
          process authored and the backlinks pointing at it, from the same
          stored rows. */}
      {id && (
        <RelatedProcesses
          processId={id}
          title={process.title}
          description={process.description}
        />
      )}

      {/* Admin-only: archive this process (soft-remove, restorable from the
          admin Archived view). Renders nothing for non-admins. */}
      {id && (
        <DetailActions>
          <CloseEarlyButton<ProcessState>
            processId={id}
            offer={voteState?.early_close}
            noun="vote"
            onView={(view) => (view ? setProcess(view) : void reload())}
          />
        </DetailActions>
      )}
    </div>
  );
}
