import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ShareMoment from "./ShareMoment";
import type { ActionResult, HeldReceiptPayload, VoteState } from "../services/api";
import {
  claimVoteReceipt,
  submitVote,
  submitApprovalVote,
  supportVote,
  unsupportVote,
  submitInput,
} from "../services/api";
import { ApiError } from "../utils/httpError";
import { dropHeldReceipt, getHeldReceipt, saveHeldReceipt, type HeldReceipt } from "../services/voteReceipts";
import { getMe, getStoredToken } from "../services/auth";
import { useRequireAuth } from "../hooks/useRequireAuth";
import { useCommentIdentityMode } from "../hooks/useCommentIdentityMode";
import AuthModal from "./AuthModal";
import hub from "../config/hub";

const COMMENT_MAX = 500;

// One collection per account and vote at a time (React's development double
// effects would otherwise ask twice, and the second answer is "nothing").
const claimsInFlight = new Map<string, Promise<HeldReceipt | null>>();

/**
 * For someone who voted before receipts moved to the voter: collect their
 * receipt and change key once, and keep them on this browser. null when
 * there is nothing to collect (they voted from another browser).
 */
function collectEarlyReceipt(actor: string, processId: string, approval: boolean): Promise<HeldReceipt | null> {
  const key = `${actor}:${processId}`;
  let p = claimsInFlight.get(key);
  if (!p) {
    p = claimVoteReceipt(processId)
      .then((r) => {
        let choice: string | string[] = r.choice;
        if (approval) {
          try {
            const parsed: unknown = JSON.parse(r.choice);
            if (Array.isArray(parsed)) choice = parsed.map(String);
          } catch {
            // Keep the stored text.
          }
        }
        const held: HeldReceipt = { receipt_id: r.receipt_id, change_key: r.change_key, choice };
        saveHeldReceipt(actor, processId, held);
        return held;
      })
      .catch(() => getHeldReceipt(actor, processId))
      .finally(() => claimsInFlight.delete(key));
    claimsInFlight.set(key, p);
  }
  return p;
}

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
  // The receipt this browser holds for this vote, if any. The hub cannot
  // look it up: it keeps nothing that links this person to their ballot.
  const [held, setHeld] = useState<HeldReceipt | null>(() => getHeldReceipt(actor, process.id));
  // Voted, and this browser has no receipt: the vote counts, but only the
  // browser it was cast from can change it.
  const [votedElsewhere, setVotedElsewhere] = useState(false);
  const [receiptNotKept, setReceiptNotKept] = useState(false);
  // The account a receipt is kept under. A vote cast right after signing up
  // runs from a callback made before sign-in, when `actor` was still
  // "anonymous": read the latest value, and ask the server if it is not in yet.
  const actorRef = useRef(actor);
  actorRef.current = actor;
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

  // A different account or vote: read what this browser holds for it.
  useEffect(() => {
    setHeld(getHeldReceipt(actor, process.id));
    setVotedElsewhere(false);
  }, [actor, process.id]);

  // Voted with no receipt here: someone who voted before receipts moved to
  // the voter collects theirs once; anyone else voted from another browser.
  useEffect(() => {
    if (!isActive || process.has_voted !== true || held) return;
    let live = true;
    collectEarlyReceipt(actor, process.id, isApproval).then((r) => {
      if (!live) return;
      if (r) setHeld(r);
      else setVotedElsewhere(true);
    });
    return () => {
      live = false;
    };
  }, [isActive, process.has_voted, held, actor, process.id, isApproval]);

  /** The signed-in account's id, even when the vote was cast from a pre-sign-in callback. */
  async function keeperId(): Promise<string> {
    const known = actorRef.current;
    if (known && known !== "anonymous") return known;
    const token = getStoredToken();
    if (!token) return "";
    try {
      return (await getMe(token)).user.id;
    } catch {
      return "";
    }
  }

  /**
   * Cast a ballot, or change it with the receipt this browser holds, and
   * keep the receipt. `send` makes the request for one method's ballot.
   */
  async function castBallot(
    choice: string | string[],
    send: (receipt: HeldReceiptPayload | null) => Promise<ActionResult>,
  ) {
    setLoading(true);
    setError(null);
    setCommentWarning(null);
    let current = held;
    try {
      let result: ActionResult;
      try {
        result = await send(current ? { receipt_id: current.receipt_id, change_key: current.change_key } : null);
      } catch (err) {
        if (err instanceof ApiError && err.code === "receipt_without_vote") {
          // A receipt on this browser that is not this account's ballot:
          // forget it and vote without it.
          dropHeldReceipt(actor, process.id);
          current = null;
          setHeld(null);
          result = await send(null);
        } else {
          throw err;
        }
      }
      const payload = result.result as Record<string, unknown>;
      const receiptId = typeof payload?.receipt_id === "string" ? payload.receipt_id : null;
      const changeKey = typeof payload?.change_key === "string" ? payload.change_key : current?.change_key ?? null;
      setJustVoted(choice);
      setVoteWasUpdated(payload?.vote_updated === true);
      if (receiptId && changeKey) {
        const next: HeldReceipt = { receipt_id: receiptId, change_key: changeKey, choice };
        // Kept before it is shown, so a re-read of storage finds it.
        setReceiptNotKept(!saveHeldReceipt(await keeperId(), process.id, next));
        setHeld(next);
      }
      await submitCommentIfPresent();
      onVoted();
    } catch (err) {
      if (err instanceof ApiError && (err.code === "already_voted" || err.code === "receipt_not_accepted")) {
        if (err.code === "receipt_not_accepted") {
          dropHeldReceipt(actor, process.id);
          setHeld(null);
        }
        setVotedElsewhere(true);
      }
      setError(err instanceof Error ? err.message : "Vote failed");
    } finally {
      setLoading(false);
    }
  }

  function doVote(option: string) {
    return castBallot(option, (receipt) => submitVote(process.id, actor, option, receipt));
  }

  async function doApprovalVote() {
    const selections = Array.from(approvalSelections);
    if (selections.length === 0) {
      setError("Select at least one option");
      return;
    }
    await castBallot(selections, (receipt) => submitApprovalVote(process.id, actor, selections, receipt));
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
        const currentVote = justVoted ?? held?.choice ?? null;
        const hasExistingVote = currentVote !== null;

        // Voted, and this browser holds no receipt: the vote counts, and only
        // the browser it was cast from can change it. Say so plainly rather
        // than offer buttons that would be refused.
        if (!hasExistingVote && (votedElsewhere || (process.has_voted === true && !held))) {
          return (
            <div className="vote-options">
              <h4>Your vote</h4>
              <div className="vote-receipt vote-receipt-elsewhere">
                <p className="vote-receipt-title">You've already voted, and your vote is counted</p>
                <p className="vote-receipt-explanation">
                  {votedElsewhere
                    ? "You can change it only from the browser where you voted, until voting closes. " +
                      "We don't keep any record that links you to your ballot, so this browser has no way to find it."
                    : "Checking this browser for your receipt…"}
                </p>
              </div>
            </div>
          );
        }

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
                placeholder={`Share concerns, suggestions, context, or any thoughts worth passing on to ${hub.governing_body_ref}. Submitted when you cast your vote.`}
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
                This is your anonymous vote receipt. This browser keeps it, so you
                can change your vote here until voting closes, and check afterwards
                that it was counted. We keep no record that links you to it.
              </p>
              {receiptNotKept && (
                <p className="vote-comment-warning">
                  This browser won't keep your receipt, so you won't be able to change
                  your vote. Your vote is counted. Copy the receipt below if you want to
                  check it after voting closes.
                </p>
              )}
              {held && (
                <>
                  <p className="vote-receipt-id">Your receipt: <code>{held.receipt_id}</code></p>
                  {/* The receipt rides in the fragment, which the browser never
                      sends to a server, so no request log records it. */}
                  <Link
                    to={`/votes/${process.id}/log#receipt=${encodeURIComponent(held.receipt_id)}`}
                    className="vote-receipt-verify-link"
                  >
                    Verify my vote
                  </Link>
                </>
              )}
              {/* The share moment lives HERE, inside the receipt, not up
                  beside the share icons at the top of the page. On a long
                  issue page those icons are several screens above where the
                  ballot is, so the old note appeared where nobody was looking
                  at the instant it fired (Adam, 2026-09-05: "it just looks
                  busy and small and not really an obvious reminder"). This is
                  where the person just acted and is already reading. */}
              <ShareMoment
                processId={process.id}
                text="Your vote is in — share this so more neighbors vote too."
              />
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
