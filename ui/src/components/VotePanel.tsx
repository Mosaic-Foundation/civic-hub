import { useState } from "react";
import { Link } from "react-router-dom";
import type { VoteState } from "../services/api";
import { submitVote, submitApprovalVote, supportVote, unsupportVote, submitInput } from "../services/api";
import { useRequireAuth } from "../hooks/useRequireAuth";
import { useCommentIdentityMode } from "../hooks/useCommentIdentityMode";
import AuthModal from "./AuthModal";

const COMMENT_MAX = 500;

interface Props {
  process: VoteState;
  actor: string;
  onVoted: () => void;
}

export default function VotePanel({ process, actor, onVoted }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justVoted, setJustVoted] = useState<string | string[] | null>(null);
  const [voteWasUpdated, setVoteWasUpdated] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [commentAnonymous, setCommentAnonymous] = useState(false);
  const [commentSubmitted, setCommentSubmitted] = useState(false);
  const [commentWarning, setCommentWarning] = useState<string | null>(null);
  const commentIdentityMode = useCommentIdentityMode();
  const [approvalSelections, setApprovalSelections] = useState<Set<string>>(new Set());
  const { requireAuth, showAuthModal, closeAuthModal, handleAuthComplete } = useRequireAuth();

  const isActive = process.status === "active";
  const isDone = process.status === "closed" || process.status === "finalized";
  const isProposed = process.status === "proposed";
  const isThresholdMet = process.status === "threshold_met";
  const canSeeResults = process.tally !== null;
  const isApproval = process.method === "approval";

  async function doVote(option: string) {
    setLoading(true);
    setError(null);
    setCommentWarning(null);
    try {
      const result = await submitVote(process.id, actor, option);
      const resultPayload = result.result as Record<string, unknown>;
      const receipt = resultPayload?.receipt_id as string | undefined;
      const updated = resultPayload?.vote_updated === true;
      setJustVoted(option);
      setVoteWasUpdated(updated);
      if (receipt) setReceiptId(receipt);
      await submitCommentIfPresent();
      onVoted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vote failed");
    } finally {
      setLoading(false);
    }
  }

  async function doApprovalVote() {
    const selections = Array.from(approvalSelections);
    if (selections.length === 0) {
      setError("Select at least one option");
      return;
    }
    setLoading(true);
    setError(null);
    setCommentWarning(null);
    try {
      const result = await submitApprovalVote(process.id, actor, selections);
      const resultPayload = result.result as Record<string, unknown>;
      const receipt = resultPayload?.receipt_id as string | undefined;
      const updated = resultPayload?.vote_updated === true;
      setJustVoted(selections);
      setVoteWasUpdated(updated);
      if (receipt) setReceiptId(receipt);
      await submitCommentIfPresent();
      onVoted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vote failed");
    } finally {
      setLoading(false);
    }
  }

  async function submitCommentIfPresent() {
    const trimmed = comment.trim();
    if (trimmed.length > 0) {
      try {
        await submitInput(
          process.id,
          trimmed,
          commentIdentityMode === "anonymous_only" || commentAnonymous,
        );
        setCommentSubmitted(true);
        setComment("");
      } catch (commentErr) {
        const msg = commentErr instanceof Error ? commentErr.message : "Failed to submit comment";
        setCommentWarning(
          `Your vote was recorded, but the comment couldn't be saved: ${msg}`,
        );
      }
    }
  }

  function handleVote(option: string) {
    requireAuth(() => doVote(option));
  }

  function handleApprovalSubmit() {
    requireAuth(() => doApprovalVote());
  }

  function toggleApprovalOption(option: string) {
    setApprovalSelections((prev) => {
      const next = new Set(prev);
      if (next.has(option)) next.delete(option);
      else next.add(option);
      return next;
    });
  }

  async function doSupport() {
    setLoading(true);
    setError(null);
    try {
      await supportVote(process.id, actor);
      onVoted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Support failed");
    } finally {
      setLoading(false);
    }
  }

  function handleSupport() {
    requireAuth(() => doSupport());
  }

  async function handleUnsupport() {
    setLoading(true);
    setError(null);
    try {
      await unsupportVote(process.id, actor);
      onVoted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove endorsement");
    } finally {
      setLoading(false);
    }
  }

  function formatCurrentVote(vote: string | string[] | null): string | null {
    if (vote === null) return null;
    if (Array.isArray(vote)) return vote.join(", ");
    return vote;
  }

  return (
    <div className="vote-panel">
      {showAuthModal && (
        <AuthModal onComplete={handleAuthComplete} onDismiss={closeAuthModal} />
      )}

      {/* Proposal/support phase */}
      {(isProposed || isThresholdMet) && (
        <div className="proposal-endorsement">
          <h4>Endorsements</h4>
          <div className="proposal-progress">
            <div className="proposal-progress-track">
              <div
                className="proposal-progress-fill"
                style={{ width: `${Math.min(100, Math.round((process.support_count / process.support_threshold) * 100))}%` }}
              />
            </div>
            <span className="proposal-progress-label">
              {process.support_count} of {process.support_threshold} endorsements
            </span>
          </div>
          {isProposed && (
            <>
              <p className="proposal-needs">
                Needs {process.support_threshold - process.support_count} more endorsement{process.support_threshold - process.support_count !== 1 ? "s" : ""} to proceed to an official vote
              </p>
              {process.has_supported ? (
                <div className="endorsement-actions">
                  <p className="endorse-confirmation">You endorsed this proposal</p>
                  <button
                    className="unendorse-button"
                    onClick={handleUnsupport}
                    disabled={loading}
                  >
                    {loading ? "Removing..." : "Remove Endorsement"}
                  </button>
                </div>
              ) : (
                <button
                  className="endorse-button"
                  onClick={handleSupport}
                  disabled={loading}
                >
                  {loading ? "Endorsing..." : "Endorse Proposal"}
                </button>
              )}
            </>
          )}
          {isThresholdMet && (
            <p className="proposal-needs">Threshold reached — awaiting activation</p>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {/* Draft state */}
      {process.status === "draft" && (
        <div className="vote-options">
          <h4>Draft</h4>
          <p>This process is still being configured.</p>
        </div>
      )}

      {/* Active voting */}
      {isActive && (() => {
        const currentVote = justVoted ?? process.your_current_vote;
        const hasExistingVote = currentVote !== null;

        return (
        <div className="vote-options">
          <h4>{hasExistingVote ? "Your vote" : "Cast your vote"}</h4>
          <p className="vote-privacy-notice">
            {hasExistingVote
              ? "You can change your vote at any time before voting closes. Votes are private — only totals are shown."
              : "Votes are private. Only total results are shown."}
          </p>

          {!hasExistingVote && (
            <div className="vote-comment-field">
              <label className="vote-comment-label" htmlFor="vote-comment">
                Your comment <span className="vote-comment-optional">(optional)</span>
              </label>
              <textarea
                id="vote-comment"
                className="vote-comment-textarea"
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))}
                placeholder="Share concerns, suggestions, context, or any thoughts worth passing on to the Board. Submitted when you cast your vote."
                rows={3}
                maxLength={COMMENT_MAX}
                disabled={loading}
              />
              <span className="vote-comment-counter">
                {comment.length} / {COMMENT_MAX}
              </span>
              {commentIdentityMode === "anonymous_optional" && comment.trim().length > 0 && (
                <label className="auth-checkbox-label comment-anonymous-toggle">
                  <input
                    type="checkbox"
                    checked={commentAnonymous}
                    onChange={(e) => setCommentAnonymous(e.target.checked)}
                    disabled={loading}
                  />
                  <span>Post my comment anonymously</span>
                </label>
              )}
            </div>
          )}

          {/* Yes/No/Unsure — original button-per-option */}
          {!isApproval && (
            <div className="vote-buttons">
              {process.options.map((option) => (
                <button
                  key={option}
                  className={`vote-button ${currentVote === option ? "voted" : ""}`}
                  onClick={() => handleVote(option)}
                  disabled={loading}
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          {/* Approval — checkboxes + submit */}
          {isApproval && (
            <div className="approval-ballot">
              <p className="approval-instruction">Select all options you approve of:</p>
              <div className="approval-choices">
                {process.options.map((option) => {
                  const isSelected = approvalSelections.has(option);
                  const wasVoted = Array.isArray(currentVote) && currentVote.includes(option);
                  return (
                    <label
                      key={option}
                      className={`approval-choice ${isSelected ? "approval-choice-selected" : ""} ${wasVoted && !justVoted ? "approval-choice-previous" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleApprovalOption(option)}
                        disabled={loading}
                      />
                      <span className="approval-choice-label">{option}</span>
                    </label>
                  );
                })}
              </div>
              <button
                className="approval-submit-btn"
                onClick={handleApprovalSubmit}
                disabled={loading || approvalSelections.size === 0}
              >
                {loading ? "Submitting..." : hasExistingVote ? "Update vote" : "Submit vote"}
              </button>
            </div>
          )}

          {justVoted && commentSubmitted && (
            <p className="vote-confirmation">
              Your vote and comment have been submitted.
            </p>
          )}
          {justVoted && voteWasUpdated && (
            <p className="vote-confirmation">
              Your vote has been updated.
            </p>
          )}
          {commentWarning && (
            <p className="vote-comment-warning">{commentWarning}</p>
          )}
          {hasExistingVote && (
            <div className="vote-receipt">
              <p className="vote-receipt-title">
                {voteWasUpdated ? "Your vote has been updated" : "Your vote has been recorded"}
              </p>
              {isApproval && currentVote && (
                <p className="vote-receipt-choices">
                  You approved: {formatCurrentVote(currentVote)}
                </p>
              )}
              <p className="vote-receipt-explanation">
                This is your anonymous vote receipt. You can use it to verify that
                your vote was included in the final results. Your identity is not
                associated with this receipt.
              </p>
              {receiptId && (
                <>
                  <p className="vote-receipt-id">Your receipt: <code>{receiptId}</code></p>
                  <Link
                    to={`/votes/${process.id}/log?receipt=${encodeURIComponent(receiptId)}`}
                    className="vote-receipt-verify-link"
                  >
                    Verify my vote
                  </Link>
                </>
              )}
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </div>
        );
      })()}

      {/* Closed / finalized voting */}
      {isDone && (
        <div className="vote-options">
          <h4>{process.status === "finalized" ? "Voting finalized" : "Voting closed"}</h4>
        </div>
      )}

      {/* View Vote Log — only shown when vote is closed or finalized */}
      {isDone && (
        <div className="vote-log-link-section">
          <Link to={`/votes/${process.id}/log`} className="vote-log-link-button">
            View Vote Log
          </Link>
        </div>
      )}

      {/* Results — visible after voting, when closed, or finalized */}
      {(isActive || isDone) && (
        <div className="vote-tally">
          <h4>Results</h4>
          {isApproval && canSeeResults && (
            <p className="tally-method-note">
              Approval voting — percentages show the share of voters who approved each option.
            </p>
          )}
          {canSeeResults ? (
            <>
              {process.options.map((option) => {
                const count = process.tally![option] ?? 0;
                const total = process.total_votes ?? 0;
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <div key={option} className="tally-row">
                    <span className="tally-label">{option}</span>
                    <div className="tally-bar-track">
                      <div
                        className="tally-bar-fill"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <span className="tally-count">
                      {count} ({pct}%)
                    </span>
                  </div>
                );
              })}
              <p className="tally-total">{process.total_votes} total votes</p>
            </>
          ) : (
            <p className="results-hidden">
              Results will be visible after you vote.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
