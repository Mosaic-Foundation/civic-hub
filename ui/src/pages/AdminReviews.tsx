import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  adminListReviews,
  adminGetReview,
  adminApproveReview,
  adminRequestChanges,
  adminDeclineReview,
  markReviewsSeen,
  type ProcessReviewSummary,
  type ReviewDetail,
  type ReviewStatus,
} from "../services/api";
import AdminTabs from "../components/AdminTabs";
import "./AdminReviews.css";
import RelatedProcesses from "../components/RelatedProcesses";

const STATUS_FILTERS: Array<{ id: "all" | ReviewStatus; label: string }> = [
  { id: "all", label: "All" },
  { id: "pending_review", label: "Pending" },
  { id: "changes_requested", label: "Changes requested" },
  { id: "approved", label: "Approved" },
  { id: "declined", label: "Declined" },
  { id: "withdrawn", label: "Withdrawn" },
];

const TYPE_LABELS: Record<string, string> = {
  "civic.vote": "Vote",
  "civic.proposal": "Proposal",
  "civic.polis_deliberation": "Conversation",
  "civic.project": "Project",
};

const STATUS_LABELS: Record<string, string> = {
  pending_review: "Pending review",
  changes_requested: "Changes requested",
  approved: "Approved",
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

export default function AdminReviews() {
  const navigate = useNavigate();
  const { reviewId: routeId } = useParams<{ reviewId?: string }>();
  const view: "list" | "detail" = routeId ? "detail" : "list";

  const [reviews, setReviews] = useState<ProcessReviewSummary[]>([]);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | ReviewStatus>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Action states
  const [showChangesForm, setShowChangesForm] = useState(false);
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [acting, setActing] = useState(false);

  function loadList() {
    setLoading(true);
    setError(null);
    adminListReviews()
      .then(setReviews)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (view === "list") {
      loadList();
    }
  }, [view]);

  // Opening the review queue clears the admin attention badge.
  useEffect(() => {
    markReviewsSeen().catch(() => {});
  }, []);

  useEffect(() => {
    if (routeId) {
      setLoading(true);
      setError(null);
      adminGetReview(routeId)
        .then(setDetail)
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [routeId]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return reviews;
    return reviews.filter((r) => r.status === statusFilter);
  }, [reviews, statusFilter]);

  function backToList() {
    setShowChangesForm(false);
    setShowDeclineForm(false);
    setNoteText("");
    setActionMessage(null);
    setError(null);
    navigate("/admin/reviews");
  }

  async function handleApprove() {
    if (!routeId || acting) return;
    setActing(true);
    setError(null);
    try {
      await adminApproveReview(routeId);
      setActionMessage("✓ Approved — it's now live (find it under its tab, e.g. Proposals/Votes).");
      const refreshed = await adminGetReview(routeId);
      setDetail(refreshed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Approve failed";
      // Already-approved (duplicate click, or a prior approve that succeeded):
      // don't show a scary error — refresh to reflect the live state.
      if (
        msg.includes("already been approved") ||
        msg.includes("Cannot approve review in status: approved")
      ) {
        setActionMessage("This submission was already approved and posted.");
        const refreshed = await adminGetReview(routeId).catch(() => null);
        if (refreshed) setDetail(refreshed);
      } else {
        setError(msg);
      }
    } finally {
      setActing(false);
    }
  }

  async function handleRequestChanges() {
    if (!routeId || acting || !noteText.trim()) return;
    setActing(true);
    setError(null);
    try {
      await adminRequestChanges(routeId, noteText.trim());
      setActionMessage("Changes requested — creator has been notified.");
      setShowChangesForm(false);
      setNoteText("");
      const refreshed = await adminGetReview(routeId);
      setDetail(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request changes failed");
    } finally {
      setActing(false);
    }
  }

  async function handleDecline() {
    if (!routeId || acting || !noteText.trim()) return;
    setActing(true);
    setError(null);
    try {
      await adminDeclineReview(routeId, noteText.trim());
      setActionMessage("Declined — creator has been notified.");
      setShowDeclineForm(false);
      setNoteText("");
      const refreshed = await adminGetReview(routeId);
      setDetail(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decline failed");
    } finally {
      setActing(false);
    }
  }

  // --- Detail view ---

  if (view === "detail") {
    const proc = detail?.process as Record<string, unknown> | undefined;
    const isPending = detail?.review.status === "pending_review";

    return (
      <div className="admin-reviews-page">
        <AdminTabs />
        <div className="admin-reviews-body">
          <button className="admin-back-link" onClick={backToList}>
            ← Back to reviews
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

              <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>
                Submitted by <strong>{detail.review.creator_name}</strong> (
                {detail.review.creator_email}) on{" "}
                {formatDate(detail.review.created_at)}
              </p>

              {/* Process content preview */}
              <div className="review-process-preview">
                <h3>Process content</h3>
                <p style={{ whiteSpace: "pre-wrap" }}>{(proc?.description as string) || "No description"}</p>

                {/* Conversation submissions carry their setup on state —
                    the admin must see the WHOLE submission (seeds, sources,
                    window) before approving, not just topic + framing. */}
                {proc?.type === "civic.polis_deliberation" &&
                  !!proc?.state &&
                  (() => {
                    const st = proc.state as Record<string, unknown>;
                    const seeds = Array.isArray(st.seed_statements)
                      ? (st.seed_statements as string[])
                      : [];
                    const sources = Array.isArray(st.sources)
                      ? (st.sources as string[])
                      : [];
                    const durationMs =
                      typeof st.duration_ms === "number" ? st.duration_ms : null;
                    const threshold =
                      typeof st.participation_threshold === "number"
                        ? st.participation_threshold
                        : null;
                    return (
                      <div className="review-conversation-details">
                        {durationMs !== null && (
                          <p>
                            <strong>Open for:</strong>{" "}
                            {Math.round(durationMs / (24 * 60 * 60 * 1000))} days
                            once started
                            {threshold
                              ? `, or until ${threshold} participants`
                              : ""}
                          </p>
                        )}
                        {sources.length > 0 && (
                          <>
                            <p style={{ marginBottom: 0 }}>
                              <strong>Sources:</strong>
                            </p>
                            <ul className="review-conversation-list">
                              {sources.map((url, i) => (
                                <li key={i}>
                                  <a href={url} target="_blank" rel="noopener noreferrer">
                                    {url}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                        {seeds.length > 0 && (
                          <>
                            <p style={{ marginBottom: 0 }}>
                              <strong>Seed statements:</strong>
                            </p>
                            <ul className="review-conversation-list">
                              {seeds.map((s, i) => (
                                <li key={i}>{s}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </div>
                    );
                  })()}
                {!!proc?.content && (
                  <details>
                    <summary>Structured content</summary>
                    <pre
                      style={{
                        fontSize: "var(--font-size-sm)",
                        whiteSpace: "pre-wrap",
                        maxHeight: "300px",
                        overflow: "auto",
                      }}
                    >
                      {JSON.stringify(proc.content, null, 2)}
                    </pre>
                  </details>
                )}
              </div>

              {/* Related processes the creator proposed, plus anything the
                  admin appends here. Editable during review, and invisible to
                  everyone else until this submission is approved — a link
                  renders only when the process it hangs off is public. */}
              {detail.review.process_id && (
                <RelatedProcesses
                  processId={detail.review.process_id}
                  title={String(proc?.title ?? "")}
                  description={String(proc?.description ?? "")}
                />
              )}

              {/* Turn thread */}
              <h2>Review thread</h2>
              <div className="review-thread">
                {detail.turns.map((turn) => (
                  <div className="review-turn" key={turn.id}>
                    <div className="review-turn-header">
                      <span>
                        <span className="review-turn-actor">
                          {turn.actor_role === "admin"
                            ? "Admin"
                            : detail.review.creator_name}
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

              {/* Admin actions (only if pending_review) */}
              {isPending && !actionMessage && (
                <>
                  {!showChangesForm && !showDeclineForm && (
                    <div className="review-actions">
                      <button
                        className="review-action-btn review-action-btn--approve"
                        onClick={handleApprove}
                        disabled={acting}
                      >
                        {acting ? "Approving…" : "Approve & post"}
                      </button>
                      <button
                        className="review-action-btn review-action-btn--changes"
                        onClick={() => {
                          setShowChangesForm(true);
                          setShowDeclineForm(false);
                          setNoteText("");
                        }}
                        disabled={acting}
                      >
                        Request changes
                      </button>
                      <button
                        className="review-action-btn review-action-btn--decline"
                        onClick={() => {
                          setShowDeclineForm(true);
                          setShowChangesForm(false);
                          setNoteText("");
                        }}
                        disabled={acting}
                      >
                        Decline
                      </button>
                    </div>
                  )}

                  {showChangesForm && (
                    <div className="review-note-area">
                      <h3>Request changes</h3>
                      <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
                        Describe the changes needed. You can suggest specific
                        wording — the creator will apply edits and resubmit.
                      </p>
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="What changes are needed?"
                      />
                      <div className="review-actions">
                        <button
                          className="review-action-btn review-action-btn--changes"
                          onClick={handleRequestChanges}
                          disabled={acting || !noteText.trim()}
                        >
                          {acting ? "Sending…" : "Send to creator"}
                        </button>
                        <button
                          className="review-action-btn review-action-btn--secondary"
                          onClick={() => {
                            setShowChangesForm(false);
                            setNoteText("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {showDeclineForm && (
                    <div className="review-note-area">
                      <h3>Decline submission</h3>
                      <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
                        Provide a reason. The creator will be notified.
                      </p>
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="Reason for declining"
                      />
                      <div className="review-actions">
                        <button
                          className="review-action-btn review-action-btn--decline"
                          onClick={handleDecline}
                          disabled={acting || !noteText.trim()}
                        >
                          {acting ? "Declining…" : "Decline"}
                        </button>
                        <button
                          className="review-action-btn review-action-btn--secondary"
                          onClick={() => {
                            setShowDeclineForm(false);
                            setNoteText("");
                          }}
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
      </div>
    );
  }

  // --- List view ---

  return (
    <div className="admin-reviews-page">
      <AdminTabs />
      <div className="admin-reviews-body">
        <h1>Process reviews</h1>
        <p style={{ color: "var(--color-text-muted)" }}>
          Resident submissions waiting for review before going live.
        </p>

        <div className="admin-review-filters">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              className={`admin-review-filter${
                statusFilter === f.id ? " is-active" : ""
              }`}
              onClick={() => setStatusFilter(f.id)}
            >
              {f.label}
              {f.id !== "all" &&
                ` (${reviews.filter((r) => r.status === f.id).length})`}
            </button>
          ))}
        </div>

        {loading && <p>Loading…</p>}
        {error && <p className="error-text">{error}</p>}

        {!loading && filtered.length === 0 && (
          <p style={{ color: "var(--color-text-muted)" }}>No reviews found.</p>
        )}

        {filtered.map((r) => (
          <div
            key={r.id}
            className="process-card"
            style={{ cursor: "pointer" }}
            onClick={() => navigate(`/admin/reviews/${r.id}`)}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
            <p style={{ margin: "var(--space-xs) 0 0", color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>
              By {r.creator_name} · {formatDate(r.updated_at)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
