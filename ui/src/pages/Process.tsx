import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getProcessState, type ProcessState, type VoteState, type ProposalState } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useRequireAuth } from "../hooks/useRequireAuth";
import VotePanel from "../components/VotePanel";
import ProposalPanel from "../components/ProposalPanel";
import Creator from "../components/Creator";
import IssueContent from "../components/IssueContent";
import CommunityInputPanel from "../components/CommunityInputPanel";
import ProposalCommentForm from "../components/ProposalCommentForm";
import AuthModal from "../components/AuthModal";
import ShareButton from "../components/ShareButton";
import RelatedProcesses from "../components/RelatedProcesses";
import DetailActions from "../components/DetailActions";
import { BriefPointer } from "../components/BriefPointer";
import AdminArchiveButton from "../components/AdminArchiveButton";
import { statusDisplay } from "../components/statusDisplay";
import ProcessHeader from "../components/ProcessHeader";
import RichText from "../components/RichText";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function Process() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { actorId } = useAuth();
  const { showAuthModal, closeAuthModal, handleAuthComplete } = useRequireAuth();
  const [process, setProcess] = useState<ProcessState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commentRefresh, setCommentRefresh] = useState(0);

  const currentActor = actorId ?? "anonymous";

  const fetchState = useCallback(async (retries = 2) => {
    if (!id) return;
    try {
      const state = await getProcessState(id);
      setProcess(state);
      setError(null);
    } catch (err) {
      if (retries > 0) {
        // Retry after a short delay — serverless cold start may need a moment
        await new Promise((r) => setTimeout(r, 1000));
        return fetchState(retries - 1);
      }
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
    // actorId isn't read here directly, but a sign-in/out changes the
    // Bearer token request() sends — refetch so has_voted /
    // your_current_vote reflect the new session.
  }, [id, actorId]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  if (loading) return <p className="detail-page">Loading...</p>;
  if (error) return (
    <div className="page detail-page">
      <p className="error">Error: {error}</p>
      <button className="retry-button" onClick={() => { setLoading(true); setError(null); fetchState(); }}>
        Try again
      </button>
    </div>
  );
  if (!process) return (
    <div className="page detail-page">
      <p>Not found.</p>
    </div>
  );

  const isVote = process.type === "civic.vote";
  const isProposal = process.type === "civic.proposal";
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
        status={statusDisplay(
          // A civic.proposal's "closed" means it was promoted to a vote —
          // pre-translate before the shared vocabulary renders it.
          isProposal && process.status === "closed" ? "promoted" :
          isProposal && process.status !== "closed" ? "gathering" :
          process.status,
        )}
        aside={
          isVote && voteState?.jurisdiction && voteState.jurisdiction !== "local" ? (
            <span className="jurisdiction-badge">{voteState.jurisdiction}</span>
          ) : null
        }
      />

      <BriefPointer processId={process.id} />

      {/* Plain description (always shown) */}
      <RichText className="process-description" text={process.description} />

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

      {/* Share — visible while the surface is gathering attention.
          Active votes (turn out the vote) + the proposal "gathering
          support" states. Suppressed once voting closes / a proposal
          archives — at that point sharing the URL no longer drives
          action. The link itself still works; users who really want
          to share can copy from the address bar. */}
      {((isVote &&
        (process.status === "active" ||
          process.status === "proposed" ||
          process.status === "threshold_met")) ||
        (isProposal && process.status !== "closed")) && (
        <div className="process-share-row">
          <ShareButton
            title={process.title}
            shareText={
              isProposal
                ? `Endorse this proposal: ${process.title}`
                : `Vote on: ${process.title}`
            }
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
          onVoted={fetchState}
        />
      )}

      {isProposal && (
        <ProposalPanel
          proposal={process as ProposalState}
          actor={currentActor}
          onEndorsed={fetchState}
        />
      )}

      {/* Comment form for proposed processes (gathering support phase) */}
      {isVote && id && (process.status === "proposed" || process.status === "threshold_met") && (
        <ProposalCommentForm
          proposalId={id}
          onCommentAdded={() => setCommentRefresh((n) => n + 1)}
        />
      )}

      {/* Community comments */}
      {isVote && id && (
        <CommunityInputPanel
          key={commentRefresh}
          processId={id}
          config={voteState?.content?.community_input}
        />
      )}

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
          <AdminArchiveButton
            processId={id}
            itemLabel="item"
            onArchived={() => navigate("/")}
          />
        </DetailActions>
      )}
    </div>
  );
}
