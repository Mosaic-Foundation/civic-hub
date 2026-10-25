import { ApiError } from "../utils/httpError";
import { useRefreshOnVisible } from "../hooks/useRefreshOnVisible";
import { useEffect, useMemo, useState } from "react";
import { useAction } from "../hooks/useAction";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  adminListReviews,
  adminGetReview,
  adminApproveReview,
  adminRequestChanges,
  adminDeclineReview,
  markReviewsSeen,
  notifyAdminQueuesChanged,
  type ProcessReviewSummary,
  type ReviewDetail,
  type ReviewStatus,
} from "../services/api";
import AdminTabs from "../components/AdminTabs";
import ProcessHeader from "../components/ProcessHeader";
import { friendlyType } from "../components/processLinkTypes";
import { typeColorSlug } from "../components/typeColor";
import "./AdminReviews.css";
import RelatedProcesses from "../components/RelatedProcesses";
import SubmissionPreview from "../components/SubmissionPreview";
import { formatShortDateTime } from "../utils/dates";

const STATUS_FILTERS: Array<{ id: "all" | ReviewStatus; label: string }> = [
  { id: "all", label: "All" },
  { id: "pending_review", label: "Pending" },
  { id: "changes_requested", label: "Changes requested" },
  { id: "approved", label: "Approved" },
  { id: "declined", label: "Declined" },
  { id: "withdrawn", label: "Withdrawn" },
];

/** Colored type pill — the same one every process page header wears. */
function TypePill({ type }: { type: string | null | undefined }) {
  const t = type ?? "";
  return (
    <span className={`process-type-pill process-type-pill--${typeColorSlug(t)}`}>
      {friendlyType(t)}
    </span>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending_review: "Pending review",
  changes_requested: "Changes requested",
  approved: "Approved",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

export default function AdminReviews() {
  const navigate = useNavigate();
  const location = useLocation();
  const { reviewId: routeId } = useParams<{ reviewId?: string }>();
  // After an approval or a decline the admin lands back on the list, with a
  // short confirmation of what just happened (Submit and Save, 2026-10-12).
  const flash = (location.state as { flash?: string } | null)?.flash ?? null;
  const view: "list" | "detail" = routeId ? "detail" : "list";

  const [reviews, setReviews] = useState<ProcessReviewSummary[]>([]);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  // Land on Pending: the reviewer's queue is what needs action, so that is
  // the default view. The All / Approved / etc. filters stay available (Adam,
  // 2026-09-05).
  const [statusFilter, setStatusFilter] = useState<"all" | ReviewStatus>("pending_review");
  // Filter by process type (Adam, 2026-09-03). Options come from the reviews
  // themselves, so a type added later appears the moment one is submitted.
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Action states
  const [showChangesForm, setShowChangesForm] = useState(false);
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [noteText, setNoteText] = useState("");
  // One runner for approve / request changes / decline: only one may run.
  const action = useAction("That didn't go through. Please try again.");
  const acting = action.busy;

  // Back in view after a while: read the queue, or this review, again,
  // quietly (another admin may have acted on it).
  useRefreshOnVisible(() => {
    if (view === "list") adminListReviews().then(setReviews).catch(() => {});
    else if (routeId) adminGetReview(routeId).then(setDetail).catch(() => {});
  });

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets this fetch's state when its input changes; one data-fetching hook replaces these (audit F6)
      loadList();
    }
  }, [view]);

  // Opening the review queue clears the admin attention badge.
  useEffect(() => {
    markReviewsSeen().then(notifyAdminQueuesChanged).catch(() => {});
  }, []);

  useEffect(() => {
    if (routeId) {
      // Reset every piece of per-review UI state before loading the next one.
      // Without this, moving between reviews WITHOUT a full page reload — an
      // email link, back/forward, or the in-app list — carried the previous
      // review's state over: a lingering actionMessage (or an open changes/
      // decline form) hides the Approve / Request changes / Decline buttons,
      // because they render only while `isPending && !actionMessage`. That is
      // the "buttons missing until I refresh" report (Adam, 2026-09-05): a
      // hard refresh remounted the page and cleared it. Clearing `detail` too
      // stops another review's content showing while this one loads.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets this fetch's state when its input changes; one data-fetching hook replaces these (audit F6)
      setDetail(null);
      setActionMessage(null);
      setShowChangesForm(false);
      setShowDeclineForm(false);
      setNoteText("");
      setLoading(true);
      setError(null);
      adminGetReview(routeId)
        .then(setDetail)
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [routeId]);

  const filtered = useMemo(() => {
    return reviews.filter(
      (r) =>
        (statusFilter === "all" || r.status === statusFilter) &&
        (typeFilter === "all" || (r.process_type ?? "") === typeFilter),
    );
  }, [reviews, statusFilter, typeFilter]);
  const typeOptions = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of reviews) {
      const t = r.process_type ?? "";
      if (t) seen.set(t, (seen.get(t) ?? 0) + 1);
    }
    return [...seen.entries()]
      .map(([type, count]) => ({ type, label: friendlyType(type), count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [reviews]);

  function backToList() {
    setShowChangesForm(false);
    setShowDeclineForm(false);
    setNoteText("");
    setActionMessage(null);
    setError(null);
    navigate("/admin/reviews");
  }

  /** The title of the review on screen, for a confirmation. */
  function reviewTitle(): string {
    const title = (detail?.process as { title?: unknown } | undefined)?.title;
    return typeof title === "string" && title.trim() ? title.trim() : "Untitled";
  }

  /** Back to the queue, saying what was just done there. */
  function backToListWith(message: string) {
    setShowChangesForm(false);
    setShowDeclineForm(false);
    setNoteText("");
    setActionMessage(null);
    setError(null);
    navigate("/admin/reviews", { state: { flash: message } });
  }

  async function handleApprove() {
    if (!routeId) return;
    setError(null);
    await action.run(
      async () => {
        await adminApproveReview(routeId);
        backToListWith(`Approved: “${reviewTitle()}” is live.`);
      },
      {
        onError: (err) => {
          const code = err instanceof ApiError ? err.code : null;
          // Already decided (a duplicate click, or another admin got there
          // first): don't show a scary error, refresh to show where it stands.
          if (code === "already_approved" || code === "review_not_pending") {
            setActionMessage(
              code === "already_approved"
                ? "This submission was already approved and posted."
                : "This submission has already been decided. Showing where it stands now.",
            );
            adminGetReview(routeId)
              .then(setDetail)
              .catch(() => {});
            return null;
          }
          return err instanceof Error && err.message ? undefined : "Approve failed";
        },
      },
    );
  }

  async function handleRequestChanges() {
    if (!routeId || !noteText.trim()) return;
    setError(null);
    await action.run(
      async () => {
        await adminRequestChanges(routeId, noteText.trim());
        setActionMessage("Changes requested — creator has been notified.");
        setShowChangesForm(false);
        setNoteText("");
        // The answer is the review's summary, not the detail with its
        // turns: read the detail again.
        setDetail(await adminGetReview(routeId));
      },
      { onError: (err) => (err instanceof Error && err.message ? undefined : "Request changes failed") },
    );
  }

  async function handleDecline() {
    if (!routeId || !noteText.trim()) return;
    setError(null);
    await action.run(
      async () => {
        await adminDeclineReview(routeId, noteText.trim());
        backToListWith(`Declined: “${reviewTitle()}”. ${detail?.review.creator_name ?? "The creator"} has been told why.`);
      },
      { onError: (err) => (err instanceof Error && err.message ? undefined : "Decline failed") },
    );
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
          {action.error && <p className="error-text" role="alert">{action.error}</p>}
          {actionMessage && (
            <p style={{ color: "var(--success-color, #2e7d32)" }}>
              {actionMessage}
            </p>
          )}

          {detail && (
            <>
              {/* Same header as every process page: type pill → title →
                  status, so the admin sees at a glance what kind of thing
                  they are reviewing. */}
              <ProcessHeader
                type={(proc?.type as string) ?? ""}
                title={(proc?.title as string) || "Untitled"}
                status={{
                  label: STATUS_LABELS[detail.review.status] ?? detail.review.status,
                  className: `status-chip review-status-${detail.review.status}`,
                }}
                sample={Boolean(proc?.is_sample)}
              >
                <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>
                  Submitted by <strong>{detail.review.creator_name}</strong> (
                  {detail.review.creator_email}) on{" "}
                  {formatShortDateTime(detail.review.created_at)}
                </p>
              </ProcessHeader>

              {/* Sent to the admins with what the Code of Conduct check
                  flagged ("Think this is wrong? Tell the admins"). The
                  resident's note, if any, is the first turn below. */}
              {detail.review.coc_flags && detail.review.coc_flags.length > 0 && (
                <section className="review-coc-flags" aria-labelledby="review-coc-flags-title">
                  <h2 id="review-coc-flags-title">Flagged by the Code of Conduct check</h2>
                  <p>
                    The check flagged this text, and {detail.review.creator_name} sent it to the admins anyway. Read it
                    and decide; approving publishes it as written.
                  </p>
                  <ul>
                    {detail.review.coc_flags.map((f, i) => (
                      <li key={i}>
                        {f.field && <strong>{fieldLabel(f.field)}: </strong>}
                        {f.message}
                        {f.quoted_text && <span className="review-coc-quote"> “{f.quoted_text}”</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Process content preview — everything the creator submitted,
                  rendered the way the live page will show it, for every
                  process type (registry-driven; see SubmissionPreview). */}
              <div className="review-process-preview">
                <SubmissionPreview
                  heading="Process content"
                  fields={detail?.submission}
                  process={proc ?? null}
                  showRaw
                />
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
                      <span>{formatShortDateTime(turn.created_at)}</span>
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
                        aria-busy={acting}
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
                        aria-busy={acting}
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
                        aria-busy={acting}
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
                          aria-busy={acting}
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
                          aria-busy={acting}
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
        <h1>Processes</h1>
        <p style={{ color: "var(--color-text-muted)" }}>
          Submissions waiting for review before going live.
        </p>
        {flash && (
          <p className="admin-review-flash" role="status">
            {flash}
          </p>
        )}

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
          <label className="admin-review-type-filter">
            <span className="admin-review-type-filter-label">Type</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Filter by process type"
            >
              <option value="all">All types</option>
              {typeOptions.map((o) => (
                <option key={o.type} value={o.type}>
                  {o.label} ({o.count})
                </option>
              ))}
            </select>
          </label>
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
                <TypePill type={r.process_type} />{" "}
                <strong>{r.process_title || "Untitled"}</strong>
              </div>
              <span className="review-chips">
                {r.coc_flags && r.coc_flags.length > 0 && (
                  <span className="status-chip review-flagged-chip">Flagged by the check</span>
                )}
                <span className={`status-chip review-status-${r.status}`}>
                  {STATUS_LABELS[r.status] ?? r.status}
                </span>
              </span>
            </div>
            <p style={{ margin: "var(--space-xs) 0 0", color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>
              By {r.creator_name} · {formatShortDateTime(r.updated_at)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "seed_statements" → "Seed statements". */
function fieldLabel(field: string): string {
  const words = field.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
