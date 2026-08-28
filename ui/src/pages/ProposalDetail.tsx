import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getCivicProposal, supportCivicProposal, type CivicProposalDetail } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useRequireAuth } from "../hooks/useRequireAuth";
import AuthModal from "../components/AuthModal";
import ShareButton from "../components/ShareButton";
import Creator from "../components/Creator";
import CommunityInputPanel from "../components/CommunityInputPanel";
import ProposalCommentForm from "../components/ProposalCommentForm";
import RelatedProcesses from "../components/RelatedProcesses";
import AdminArchiveButton from "../components/AdminArchiveButton";
import { statusDisplay } from "../components/statusDisplay";


function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}


export default function ProposalDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { actorId } = useAuth();
  const { requireAuth, showAuthModal, closeAuthModal, handleAuthComplete } = useRequireAuth();
  const [proposal, setProposal] = useState<CivicProposalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [supporting, setSupporting] = useState(false);
  const [commentRefresh, setCommentRefresh] = useState(0);

  const currentActor = actorId ?? "anonymous";

  const fetchProposal = useCallback(() => {
    if (!id) return;
    getCivicProposal(id)
      .then(setProposal)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id, currentActor]);

  useEffect(() => {
    fetchProposal();
  }, [fetchProposal]);

  async function doSupport() {
    if (!id || !actorId) return;
    setSupporting(true);
    setError(null);
    try {
      await supportCivicProposal(id, actorId);
      fetchProposal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to support");
    } finally {
      setSupporting(false);
    }
  }

  function handleSupport() {
    requireAuth(() => doSupport());
  }

  if (loading) return <p className="detail-page">Loading...</p>;
  if (error && !proposal) return <p className="detail-page error">Error: {error}</p>;
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

      <div className="process-header">
        <h1>{proposal.title}</h1>
        <span className={statusDisplay(proposal.status).className}>
          {statusDisplay(proposal.status).label}
        </span>
      </div>

      {proposal.description && (
        <p className="process-description">{proposal.description}</p>
      )}

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
          <span>Closed {formatDate(proposal.closes_at)}</span>
        )}
      </div>

      {proposal.assistant_helped && (
        <p className="assistant-helped-label">Drafted with assistant help</p>
      )}

      {/* Share — visible while the proposal is open */}
      {proposal.status === "submitted" && (
        <div className="process-share-row">
          <ShareButton
            title={proposal.title}
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
            {error && <p className="form-error">{error}</p>}
            {proposal.has_supported ? (
              <p className="endorse-confirmation">You have supported this proposal.</p>
            ) : (
              <button
                className="endorse-button"
                onClick={handleSupport}
                disabled={supporting}
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

      {/* Links */}
      {proposal.optional_links.length > 0 && (
        <div className="proposal-links-section">
          <h3>Related Links</h3>
          <ul className="issue-link-list">
            {proposal.optional_links.map((link, i) => {
              const urlMatch = link.match(/(https?:\/\/\S+)/);
              const url = urlMatch ? urlMatch[1] : link;
              const label = urlMatch ? link.replace(url, "").replace(/:\s*$/, "").trim() : "";
              return (
                <li key={i}>
                  {label ? (
                    <>{label}: <a href={url} target="_blank" rel="noopener noreferrer">{url}</a></>
                  ) : (
                    <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Admin-only soft-remove. Renders nothing for everyone else. */}
      <AdminArchiveButton
        processId={proposal.id}
        itemLabel="proposal"
        onArchived={() => navigate("/propose")}
      />

      <RelatedProcesses
        processId={proposal.id}
        title={proposal.title}
        description={proposal.description}
      />

      {/* Comments — form only for active proposals; read-only list always shown */}
      {(proposal.status === "submitted" || proposal.status === "endorsed") && (
        <ProposalCommentForm
          proposalId={proposal.id}
          onCommentAdded={() => setCommentRefresh((n) => n + 1)}
        />
      )}
      <CommunityInputPanel
        key={commentRefresh}
        processId={proposal.id}
        config={{ label: "Community discussion on this proposal." }}
      />
    </div>
  );
}
