import { useEffect, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  getMyReviews,
  getReviewDetail,
  reviseReview,
  withdrawReview,
  markReviewsSeen,
  type ProcessReviewSummary,
  type ReviewDetail,
} from "../services/api";
import "./MySubmissions.css";
import RelatedProcesses from "../components/RelatedProcesses";

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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
  const justSubmitted = (location.state as { submitted?: boolean })?.submitted === true;
  const [actionMessage, setActionMessage] = useState<string | null>(
    justSubmitted ? "Submitted! An admin will review your submission shortly." : null,
  );

  // Revise form
  const [showRevise, setShowRevise] = useState(false);
  const [revTitle, setRevTitle] = useState("");
  const [revDescription, setRevDescription] = useState("");
  const [revNote, setRevNote] = useState("");
  const [acting, setActing] = useState(false);

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

  if (!user) {
    return (
      <div className="my-submissions-page">
        <p>Sign in to view your submissions.</p>
      </div>
    );
  }

  async function handleRevise() {
    if (!routeId || acting) return;
    setActing(true);
    setError(null);
    try {
      await reviseReview(routeId, {
        title: revTitle,
        description: revDescription,
        note: revNote || undefined,
      });
      setActionMessage("Revised and resubmitted for review.");
      setShowRevise(false);
      setRevNote("");
      const refreshed = await getReviewDetail(routeId);
      setDetail(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revision failed");
    } finally {
      setActing(false);
    }
  }

  async function handleWithdraw() {
    if (!routeId || acting) return;
    setActing(true);
    setError(null);
    try {
      await withdrawReview(routeId);
      setActionMessage("Withdrawn.");
      setConfirmWithdraw(false);
      const refreshed = await getReviewDetail(routeId);
      setDetail(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdraw failed");
    } finally {
      setActing(false);
    }
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
        {actionMessage && (
          <p style={{ color: "var(--success-color, #2e7d32)" }}>
            {actionMessage}
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

            {/* Current content */}
            <div className="submission-detail-section">
              <h2>Your submission</h2>
              <p style={{ whiteSpace: "pre-wrap" }}>{(proc?.description as string) || "No description"}</p>
            </div>

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
                      <span>{formatDate(turn.created_at)}</span>
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
                      onClick={() => setShowRevise(true)}
                    >
                      Edit & resubmit
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
                      style={{ minHeight: "60px" }}
                    />
                    <div className="review-actions">
                      <button
                        className="review-action-btn review-action-btn--approve"
                        onClick={handleRevise}
                        disabled={acting || !revTitle.trim() || !revDescription.trim()}
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
            {formatDate(r.updated_at)}
          </p>
        </div>
      ))}
    </div>
  );
}
