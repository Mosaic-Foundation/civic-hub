import { useEffect, useState } from "react";
import { useRefreshOnVisible } from "../hooks/useRefreshOnVisible";
import { useAction } from "../hooks/useAction";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import { useAuth } from "../context/authState";
import {
  getMyReviews,
  getReviewDetail,
  reviseReview,
  reopenReview,
  withdrawReview,
  markReviewsSeen,
  type ProcessReviewSummary,
  type ReviewDetail,
} from "../services/api";
import "./MySubmissions.css";
import RelatedProcesses from "../components/RelatedProcesses";
import SubmissionPreview from "../components/SubmissionPreview";
import SharePrompt from "../components/SharePrompt";
import { formatShortDateTime } from "../utils/dates";

const TYPE_LABELS: Record<string, string> = {
  "civic.vote": "Vote",
  "civic.proposal": "Proposal",
  "civic.polis_deliberation": "Conversation",
  "civic.project": "Project",
};

const STATUS_LABELS: Record<string, string> = {
  pending_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved & live",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

export default function MySubmissions() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { reviewId: routeId } = useParams<{ reviewId?: string }>();
  const view: "list" | "detail" = routeId ? "detail" : "list";

  const [reviews, setReviews] = useState<ProcessReviewSummary[]>([]);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Arriving straight from a submit: say what just happened, once. It is not
  // the page's action result: it never hides the actions, it shows only while
  // the review is still waiting (an admin may have acted since), and the
  // history entry's state is cleared, because a browser keeps it across
  // reloads. Kept, it hid "Edit & resubmit" on a review whose changes were
  // requested later, for as long as the resident stayed on that tab (seen on
  // dev 2026-10-12; the gate dates from June).
  const [arrival] = useState<string | null>(() => {
    const arrived = location.state as { submitted?: boolean; flagged?: boolean; checkUnavailable?: boolean } | null;
    if (arrived?.submitted !== true) return null;
    return arrived.flagged
      ? "Sent to the admins, with what the Code of Conduct check flagged and your note. An admin will read it and decide."
      : arrived.checkUnavailable
        ? "Submitted. The automated Code of Conduct check couldn't run, so an admin will read it before it goes live."
        : "Submitted! An admin will review your submission shortly.";
  });
  useEffect(() => {
    if (location.state) navigate(location.pathname, { replace: true, state: null });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** The result of an action taken on this page (revise, withdraw). */
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Revise form
  const [showRevise, setShowRevise] = useState(false);
  const [revTitle, setRevTitle] = useState("");
  const [revDescription, setRevDescription] = useState("");
  const [revNote, setRevNote] = useState("");
  // One runner for reopen / revise / withdraw: only one may run at a time.
  const action = useAction("That didn't go through. Please try again.");
  const acting = action.busy;

  // Withdraw confirmation
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (view === "list") {
      setLoading(true);
      getMyReviews()
        .then(setReviews)
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [view, user]);

  // Viewing this page clears the attention badge, regardless of whether the
  // user acts on anything. Best-effort — failure just leaves the badge up.
  useEffect(() => {
    if (!user) return;
    markReviewsSeen().catch(() => {});
  }, [user]);

  useEffect(() => {
    if (routeId) {
      setLoading(true);
      setError(null);
      getReviewDetail(routeId)
        .then((d) => {
          setDetail(d);
          const proc = d.process as Record<string, unknown>;
          setRevTitle((proc?.title as string) ?? "");
          setRevDescription((proc?.description as string) ?? "");
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [routeId]);
  // Back in view after a while: read it again (a second tab catches up).
  // Quietly: the list, or this review's status (an admin may have acted),
  // leaving a revision being written alone.
  useRefreshOnVisible(() => {
    if (!user) return;
    if (view === "list") getMyReviews().then(setReviews).catch(() => {});
    else if (routeId) getReviewDetail(routeId).then(setDetail).catch(() => {});
  });

  if (!user) {
    return (
      <div className="my-submissions-page">
        <p>Sign in to view your submissions.</p>
      </div>
    );
  }

  /**
   * "Edit & resubmit": reopen the creator's real drafting form (banner,
   * sources, options, seeds, links — the whole submission), and submit from
   * there as a revision. Reviews without a draft on record (older ones)
   * fall back to the inline title/description form.
   */
  async function handleEditAndResubmit() {
    if (!routeId) return;
    setError(null);
    await action.run(
      async () => {
        const target = await reopenReview(routeId);
        if (target.draft_path) {
          navigate(target.draft_path);
          return;
        }
        setShowRevise(true);
      },
      { onError: (err) => (err instanceof Error && err.message ? undefined : "Could not reopen your draft") },
    );
  }

  async function handleRevise() {
    if (!routeId) return;
    setError(null);
    await action.run(
      async () => {
        await reviseReview(routeId, {
          title: revTitle,
          description: revDescription,
          note: revNote || undefined,
        });
        setActionMessage("Revised and resubmitted for review.");
        setShowRevise(false);
        setRevNote("");
        // The answer is the review's summary; the detail carries the turns.
        setDetail(await getReviewDetail(routeId));
      },
      { onError: (err) => (err instanceof Error && err.message ? undefined : "Revision failed") },
    );
  }

  async function handleWithdraw() {
    if (!routeId) return;
    setError(null);
    await action.run(
      async () => {
        await withdrawReview(routeId);
        setActionMessage("Withdrawn.");
        setConfirmWithdraw(false);
        setDetail(await getReviewDetail(routeId));
      },
      { onError: (err) => (err instanceof Error && err.message ? undefined : "Withdraw failed") },
    );
  }

  function backToList() {
    setShowRevise(false);
    setConfirmWithdraw(false);
    setActionMessage(null);
    setError(null);
    navigate("/my-submissions");
  }

  // --- Detail view ---

  if (view === "detail") {
    const proc = detail?.process as Record<string, unknown> | undefined;
    const canRevise = detail?.review.status === "changes_requested";
    const canWithdraw =
      detail?.review.status === "pending_review" ||
      detail?.review.status === "changes_requested";

    return (
      <div className="my-submissions-page">
        <button className="admin-back-link" onClick={backToList}>
          ← Back to my submissions
        </button>

        {loading && <p>Loading…</p>}
        {error && <p className="error-text">{error}</p>}
        {(actionMessage ?? (detail?.review.status === "pending_review" ? arrival : null)) && (
          <p style={{ color: "var(--color-success)" }} role="status">
            {actionMessage ?? arrival}
          </p>
        )}

        {detail && (
          <>
            <h1>{(proc?.title as string) || "Untitled"}</h1>
            <p>
              <span className="review-type-badge">
                {TYPE_LABELS[(proc?.type as string) ?? ""] ?? proc?.type}
              </span>
              <span
                className={`status-chip review-status-${detail.review.status}`}
              >
                {STATUS_LABELS[detail.review.status] ?? detail.review.status}
              </span>
            </p>

            {/* Current content — everything that was submitted, rendered the
                way the live page will show it (banner, sources, options, …). */}
            <div className="submission-detail-section">
              <SubmissionPreview
                heading="Your submission"
                fields={detail.submission}
                process={proc ?? null}
              />
            </div>

            {/* The creator's share moment. It cannot live at submission — a
                submitted process is `pending_review`, which NON_PUBLIC_STATUSES
                makes unfetchable, so the link would be dead. Once approved it
                is live, and this is where the creator comes to check
                (Adam, 2026-09-04). Same one-per-process dismissal as
                everywhere else. */}
            {/* The obvious way from "approved & live" to the live page. This
                page is the record of the submission and its review; the
                process itself is at detail_path (Adam, 2026-09-06: "my
                submissions should have linked to this one where it actually
                shows the completed and where it looks right"). */}
            {detail.review.status === "approved" && detail.detail_path && (
              <p className="submission-live-link">
                <Link to={detail.detail_path} className="endorse-button">
                  View it live →
                </Link>
              </p>
            )}
            {detail.review.status === "approved" && detail.detail_path && (
              <SharePrompt
                processId={detail.review.process_id ?? detail.review.id}
                title={String(proc?.title ?? "")}
                url={`${window.location.origin}${detail.detail_path}`}
                line="This is live now. Share it so neighbors can find it."
              />
            )}

            {detail.review.process_id && (
              <RelatedProcesses
                processId={detail.review.process_id}
                title={String(proc?.title ?? "")}
                description={String(proc?.description ?? "")}
              />
            )}

            {/* Review thread */}
            <div className="submission-detail-section">
              <h2>Review history</h2>
              <div className="review-thread">
                {detail.turns.map((turn) => (
                  <div className="review-turn" key={turn.id}>
                    <div className="review-turn-header">
                      <span>
                        <span className="review-turn-actor">
                          {turn.actor_role === "admin"
                            ? "Admin"
                            : "You"}
                        </span>{" "}
                        — {turn.action.replace(/_/g, " ")}
                      </span>
                      <span>{formatShortDateTime(turn.created_at)}</span>
                    </div>
                    {turn.note && (
                      <div className="review-turn-note">{turn.note}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            {!actionMessage && (
              <>
                {canRevise && !showRevise && (
                  <div className="review-actions">
                    <button
                      className="review-action-btn review-action-btn--approve"
                      onClick={handleEditAndResubmit}
                      disabled={acting}
                      aria-busy={acting}
                    >
                      {acting ? "Opening…" : "Edit & resubmit"}
                    </button>
                    <button
                      className="review-action-btn review-action-btn--secondary"
                      onClick={() => setConfirmWithdraw(true)}
                    >
                      Withdraw
                    </button>
                  </div>
                )}

                {canWithdraw && !canRevise && !confirmWithdraw && (
                  <div className="review-actions">
                    <button
                      className="review-action-btn review-action-btn--secondary"
                      onClick={() => setConfirmWithdraw(true)}
                    >
                      Withdraw submission
                    </button>
                  </div>
                )}

                {showRevise && (
                  <div className="submission-revise-form">
                    <h3>Revise your submission</h3>
                    <label htmlFor="rev-title">Title</label>
                    <input
                      id="rev-title"
                      value={revTitle}
                      onChange={(e) => setRevTitle(e.target.value)}
                    />
                    <label htmlFor="rev-desc">Description</label>
                    <textarea
                      id="rev-desc"
                      value={revDescription}
                      onChange={(e) => setRevDescription(e.target.value)}
                    />
                    <label htmlFor="rev-note">Note to admin (optional)</label>
                    <textarea
                      id="rev-note"
                      value={revNote}
                      onChange={(e) => setRevNote(e.target.value)}
                      placeholder="Describe what you changed"
                      style={{ minHeight: "calc(var(--control-height) * 1.5)" }}
                    />
                    <div className="review-actions">
                      <button
                        className="review-action-btn review-action-btn--approve"
                        onClick={handleRevise}
                        disabled={acting || !revTitle.trim() || !revDescription.trim()}
                        aria-busy={acting}
                      >
                        {acting ? "Submitting…" : "Resubmit"}
                      </button>
                      <button
                        className="review-action-btn review-action-btn--secondary"
                        onClick={() => setShowRevise(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {confirmWithdraw && (
                  <div style={{ marginTop: "var(--space-md)" }}>
                    <p>
                      Are you sure you want to withdraw this submission? This
                      cannot be undone.
                    </p>
                    <div className="review-actions">
                      <button
                        className="review-action-btn review-action-btn--decline"
                        onClick={handleWithdraw}
                        disabled={acting}
                      aria-busy={acting}
                      >
                        {acting ? "Withdrawing…" : "Yes, withdraw"}
                      </button>
                      <button
                        className="review-action-btn review-action-btn--secondary"
                        onClick={() => setConfirmWithdraw(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    );
  }

  // --- List view ---

  return (
    <div className="my-submissions-page">
      <h1>My submissions</h1>
      <p style={{ color: "var(--color-text-muted)" }}>
        Track the status of things you've submitted for review.
      </p>

      {loading && <p>Loading…</p>}
      {error && <p className="error-text">{error}</p>}
      {action.error && <p className="error-text" role="alert">{action.error}</p>}

      {!loading && reviews.length === 0 && (
        <p style={{ color: "var(--color-text-muted)" }}>
          You haven't submitted anything yet.
        </p>
      )}

      {reviews.map((r) => (
        <div
          key={r.id}
          className="submission-card"
          onClick={() => navigate(`/my-submissions/${r.id}`)}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <span className="review-type-badge">
                {TYPE_LABELS[r.process_type ?? ""] ?? r.process_type}
              </span>
              <strong>{r.process_title || "Untitled"}</strong>
            </div>
            <span className={`status-chip review-status-${r.status}`}>
              {STATUS_LABELS[r.status] ?? r.status}
            </span>
          </div>
          <p
            style={{
              margin: "var(--space-xs) 0 0",
              color: "var(--color-text-muted)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            {formatShortDateTime(r.updated_at)}
          </p>
        </div>
      ))}
    </div>
  );
}
