import { useApi } from "../hooks/useApi";
import { useParams, useNavigate } from "react-router-dom";
import { getCivicProposal, supportCivicProposal, unsupportCivicProposal, type CivicProposalDetail } from "../services/api";
import { useAction } from "../hooks/useAction";
import { useAuth } from "../context/authState";
import { useRequireAuth } from "../hooks/useRequireAuth";
import AuthModal from "../components/AuthModal";
import ShareButton from "../components/ShareButton";
import ShareMoment from "../components/ShareMoment";
import Creator from "../components/Creator";
import CommunityInputPanel from "../components/CommunityInputPanel";
import ProposalCommentForm from "../components/ProposalCommentForm";
import RelatedProcesses from "../components/RelatedProcesses";
import DetailActions from "../components/DetailActions";
import { CloseEarlyButton, ClosedEarlyNote } from "../components/CloseEarly";
import { BriefPointer } from "../components/BriefPointer";
import AdminArchiveButton from "../components/AdminArchiveButton";
import { statusDisplay } from "../components/statusDisplay";
import ProcessHeader from "../components/ProcessHeader";
import RichText from "../components/RichText";
import EditHistory from "../components/EditHistory";
import SourceLinks from "../components/SourceLinks";
import { formatDate } from "../utils/dates";


export default function ProposalDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { actorId } = useAuth();
  const { requireAuth, showAuthModal, closeAuthModal, handleAuthComplete } = useRequireAuth();
  const action = useAction("Your support didn't go through. Please try again.");
  const supporting = action.busy;

  const currentActor = actorId ?? "anonymous";

  // Read again on sign-in/out (whether you support it) and when the tab comes
  // back into view; a failed re-read leaves the proposal on screen.
  const {
    data: proposal,
    loading,
    error,
    reload: fetchProposal,
    setData: setProposal,
  } = useApi<CivicProposalDetail>(id ? `proposal/${id}` : null, () => getCivicProposal(id!), {
    refreshOnVisible: true,
    rereadOn: currentActor,
  });

  function doSupport() {
    if (!id || !actorId) return;
    return action.run(async () => {
      const answer = await supportCivicProposal(id, actorId);
      if (answer.view) setProposal(answer.view);
      else fetchProposal();
    });
  }

  function doUnsupport() {
    if (!id) return;
    return action.run(async () => {
      const answer = await unsupportCivicProposal(id);
      if (answer.view) setProposal(answer.view);
      else fetchProposal();
    });
  }

  function handleSupport() {
    requireAuth(() => doSupport());
  }

  if (loading) return <p className="detail-page">Loading...</p>;
  if (error && !proposal) return <p className="detail-page error">Error: {error.message}</p>;
  if (!proposal) return (
    <div className="page detail-page">
      <p>Not found.</p>
    </div>
  );

  return (
    <div className="page detail-page">
      {showAuthModal && (
        <AuthModal onComplete={handleAuthComplete} onDismiss={closeAuthModal} />
      )}

      <ProcessHeader
        type="civic.proposal"
        title={proposal.title}
        status={statusDisplay(proposal.status)}
        sample={Boolean(proposal.is_sample)}
      />

      <BriefPointer processId={proposal.id} />

      {proposal.description && (
        <RichText className="process-description" text={proposal.description} />
      )}
      <EditHistory processId={proposal.id} />

      <div className="process-meta">
        <Creator
          name={proposal.creator_name}
          isAdmin={proposal.creator_is_admin}
          officialType={proposal.creator_official_type}
          officialTitle={proposal.creator_official_title}
          prefix="Proposed by"
        />
        <span>Submitted {formatDate(proposal.created_at)}</span>
        {proposal.closes_at && proposal.status === "submitted" && (
          <span>Open until {formatDate(proposal.closes_at)}</span>
        )}
        {proposal.closes_at && proposal.status === "closed" && (
          <span>Closed {formatDate(proposal.closed_early?.at ?? proposal.closes_at)}</span>
        )}
      </div>

      {/* Closed before its deadline: the line and the admin's note. */}
      <ClosedEarlyNote closedEarly={proposal.closed_early} />

      {proposal.assistant_helped && (
        <p className="assistant-helped-label">Drafted with assistant help</p>
      )}

      {/* Share — visible while the proposal is open */}
      {proposal.status === "submitted" && (
        <div className="process-share-row">
          <ShareButton
            title={proposal.title}
            processId={proposal.id}
            shareText={`Support this proposal: ${proposal.title}`}
          />
        </div>
      )}

      {/* Support section */}
      {proposal.status === "submitted" && (
        <div className="proposal-endorsement-section">
          {proposal.support_count > 0 && (
            <p className="proposal-supporters-detail">
              {proposal.support_count}{" "}
              {proposal.support_count === 1 ? "supporter" : "supporters"}
            </p>
          )}

          <div className="proposal-action">
            {(action.error || error) && <p className="form-error">{action.error ?? error?.message}</p>}
            {proposal.has_supported ? (
              <>
                <p className="endorse-confirmation">You have supported this proposal.</p>
                {/* Withdrawable while the proposal is open — the same rule a
                    proposed vote has for its endorsements. Once it closes the
                    count is part of the record and this button is gone with
                    the rest of the open-state UI. */}
                <button
                  type="button"
                  className="unendorse-button"
                  onClick={doUnsupport}
                  disabled={supporting}
                  aria-busy={supporting}
                >
                  {supporting ? "Removing..." : "Remove my support"}
                </button>
                <ShareMoment
                  processId={proposal.id}
                  text="You endorsed this — share it so more neighbors can too."
                />
              </>
            ) : (
              <button
                className="endorse-button"
                onClick={handleSupport}
                disabled={supporting}
                aria-busy={supporting}
              >
                {supporting ? "Supporting..." : "Support this proposal"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Backward compat: endorsed proposals from before Slice B */}
      {proposal.status === "endorsed" && (
        <div className="proposal-endorsed-notice">
          <h3>Endorsed</h3>
          <p>
            This proposal received enough community support and is awaiting
            admin review.
          </p>
        </div>
      )}

      {proposal.status === "converted" && (
        <div className="proposal-converted-notice">
          <p>This proposal has been converted to an official vote.</p>
        </div>
      )}

      {proposal.status === "closed" && (
        <div className="proposal-archived-notice">
          <p>
            This proposal's discussion period has ended. It's no longer
            accepting support, but the discussion below remains for reference.
          </p>
        </div>
      )}

      {proposal.status === "archived" && (
        <div className="proposal-archived-notice">
          <p>This proposal has been archived.</p>
        </div>
      )}

      {/* Sources — was its own parser that put the title OUTSIDE the link
          and used the raw URL as the link text. One renderer for every type
          now. */}
      <SourceLinks sources={proposal.optional_links} />

      <RelatedProcesses
        processId={proposal.id}
        title={proposal.title}
        description={proposal.description}
      />

      {/* Comments — form only for active proposals; read-only list always shown */}
      {(proposal.status === "submitted" || proposal.status === "endorsed") && (
        <ProposalCommentForm proposalId={proposal.id} />
      )}
      <CommunityInputPanel
        processId={proposal.id}
        config={{ label: "Community discussion on this proposal." }}
      />

      {/* Admin-only soft-remove, last thing on the page. */}
      <DetailActions>
        <CloseEarlyButton<CivicProposalDetail>
          processId={proposal.id}
          offer={proposal.early_close}
          noun="proposal"
          onView={(view) => (view ? setProposal(view) : fetchProposal())}
        />
        <AdminArchiveButton
          processId={proposal.id}
          itemLabel="proposal"
          onArchived={() => navigate("/propose")}
        />
      </DetailActions>
    </div>
  );
}
