import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  adminListVoteResults,
  adminGetVoteResults,
  adminPatchVoteResults,
  adminApproveVoteResults,
  type VoteResultsDetail,
  type VoteResultsPublicationStatus,
  type VoteResultsSummary,
} from "../services/api";
import AdminTabs from "../components/AdminTabs";
import PostImagePicker from "../components/PostImagePicker";
import hub from "../config/hub";
import "./AdminVoteResults.css";

const STATUS_FILTERS: Array<{
  id: "all" | VoteResultsPublicationStatus;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "published", label: "Published" },
];

export default function AdminVoteResults() {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id?: string }>();
  const view: "list" | "review" = routeId ? "review" : "list";

  const [records, setRecords] = useState<VoteResultsSummary[]>([]);
  const [selected, setSelected] = useState<VoteResultsDetail | null>(null);
  const [statusFilter, setStatusFilter] = useState<
    "all" | VoteResultsPublicationStatus
  >("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Review form state
  const [commentsText, setCommentsText] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageAlt, setImageAlt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);

  function loadList() {
    setLoading(true);
    setError(null);
    adminListVoteResults()
      .then(setRecords)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadList();
  }, []);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return records;
    return records.filter((b) => b.publication_status === statusFilter);
  }, [records, statusFilter]);

  function openReview(id: string) {
    setError(null);
    setActionMessage(null);
    navigate(`/admin/vote-results/${id}`);
  }

  function backToList() {
    setConfirmingApprove(false);
    setActionMessage(null);
    setError(null);
    navigate("/admin/vote-results");
  }

  // Load the selected record whenever the URL id changes.
  useEffect(() => {
    if (!routeId) {
      setSelected(null);
      return;
    }
    setError(null);
    setActionMessage(null);
    adminGetVoteResults(routeId)
      .then((record) => {
        setSelected(record);
        setCommentsText(record.content.comments.join("\n"));
        setAdminNotes(record.content.admin_notes);
        setImageUrl(record.content.image_url ?? null);
        setImageAlt(record.content.image_alt ?? null);
        setConfirmingApprove(false);
      })
      .catch((err: Error) => setError(err.message));
  }, [routeId]);

  function buildPatch() {
    const altTrimmed = (imageAlt ?? "").trim();
    return {
      comments: parseCommentsText(commentsText),
      admin_notes: adminNotes,
      image_url: imageUrl,
      // Alt is optional. Only send a non-empty string; otherwise null
      // so the field clears on save.
      image_alt: imageUrl && altTrimmed.length > 0 ? altTrimmed : null,
    };
  }

  async function saveDraft() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await adminPatchVoteResults(selected.id, buildPatch());
      setSelected(updated);
      setImageUrl(updated.content.image_url ?? null);
      setImageAlt(updated.content.image_alt ?? null);
      setActionMessage("Draft saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function approve() {
    if (!selected) return;
    setApproving(true);
    setError(null);
    try {
      // Save any unsaved edits first so the published record matches
      // what the admin is looking at.
      await adminPatchVoteResults(selected.id, buildPatch());
      const { vote_results } = await adminApproveVoteResults(selected.id);
      setSelected(vote_results);
      setActionMessage(
        `Approved. Vote results delivered to ${vote_results.delivered_to.length} recipient(s) and published to the feed.`,
      );
      setConfirmingApprove(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setApproving(false);
    }
  }

  if (view === "review" && selected) {
    const isPending = selected.publication_status === "pending";
    const ctx = selected.content.vote_context;
    return (
      <div className="page admin-briefs-page">
        <AdminTabs />
        <div className="admin-briefs-body">
          <button className="admin-back-link" onClick={backToList} type="button">
            &larr; Back to Briefs
          </button>
          <h1>Review: {selected.title}</h1>
          <p className="admin-subtitle">
            Status: <StatusChip status={selected.publication_status} /> · Generated{" "}
            {formatDateTime(selected.generated_at)}
          </p>

          {actionMessage && <p className="admin-action-message">{actionMessage}</p>}
          {error && <p className="form-error">{error}</p>}

          <section className="admin-detail-section">
            <h3>Participation</h3>
            <p>
              {selected.content.participation_count} resident
              {selected.content.participation_count === 1 ? "" : "s"} voted.
            </p>
          </section>

          <section className="admin-detail-section">
            <h3>Positions</h3>
            <ul className="brief-positions-list">
              {selected.content.position_breakdown.map((p) => (
                <li key={p.option_id}>
                  <strong>{p.option_label}:</strong> {p.count} ({p.percentage}%)
                </li>
              ))}
            </ul>
          </section>

          <section className="admin-detail-section">
            <h3>About this vote</h3>
            <p className="form-hint">
              Snapshotted from the original vote at the time the results were
              generated. Read-only — editing this would defeat the snapshot.
            </p>
            {ctx ? (
              <div className="admin-vote-context">
                {ctx.description && (
                  <div className="admin-vote-context-description">
                    {ctx.description.split(/\n\n+/).map((para, i) => (
                      <p key={i}>{para}</p>
                    ))}
                  </div>
                )}
                {ctx.options.length > 0 && (
                  <>
                    <p className="admin-vote-context-options-label">
                      <strong>Options on the ballot:</strong>
                    </p>
                    <ul>
                      {ctx.options.map((o) => (
                        <li key={o.option_id}>{o.option_label}</li>
                      ))}
                    </ul>
                  </>
                )}
                {(ctx.starts_at || ctx.ends_at) && (
                  <p className="admin-vote-context-window">
                    {formatVotingWindow(ctx.starts_at, ctx.ends_at)}
                  </p>
                )}
              </div>
            ) : (
              <p className="empty-state-inline">
                Original vote context not available for this earlier record.
              </p>
            )}
          </section>

          <section className="admin-detail-section">
            <h3>Community comments</h3>
            <p className="form-hint">
              One comment per line. Empty lines are ignored; duplicates are
              removed. Pre-populated from civic.input — edit anything worth
              surfacing to the Board.
            </p>
            <textarea
              className="form-textarea"
              rows={6}
              value={commentsText}
              onChange={(e) => setCommentsText(e.target.value)}
              disabled={!isPending}
              placeholder="(none)"
            />
          </section>

          <section className="admin-detail-section">
            <h3>Notes from the Civic Hub</h3>
            <p className="form-hint">
              Optional admin-authored context delivered alongside the results.
            </p>
            <textarea
              className="form-textarea"
              rows={4}
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              disabled={!isPending}
              placeholder="(none)"
            />
          </section>

          <section className="admin-detail-section">
            <h3>Featured image</h3>
            <p className="form-hint">
              Optional. Renders as the lead image on the published vote-results
              page and as the feed card visual. JPEG, PNG, WebP, or GIF.
            </p>
            <PostImagePicker
              imageUrl={imageUrl}
              imageAlt={imageAlt}
              onChange={({ image_url, image_alt }) => {
                setImageUrl(image_url);
                setImageAlt(image_alt);
              }}
              disabled={!isPending || saving || approving}
            />
          </section>

          {selected.delivered_to.length > 0 && (
            <section className="admin-detail-section">
              <h3>Delivered to</h3>
              <ul>
                {selected.delivered_to.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </section>
          )}

          {isPending && (
            <div className="admin-actions">
              <button
                type="button"
                className="admin-archive-button"
                onClick={saveDraft}
                disabled={saving || approving}
              >
                {saving ? "Saving…" : "Save draft"}
              </button>
              {confirmingApprove ? (
                <>
                  <button
                    type="button"
                    className="admin-convert-button"
                    onClick={approve}
                    disabled={approving}
                  >
                    {approving ? "Approving…" : "Confirm: approve and publish"}
                  </button>
                  <button
                    type="button"
                    className="admin-cancel-button"
                    onClick={() => setConfirmingApprove(false)}
                    disabled={approving}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="admin-convert-button"
                  onClick={() => setConfirmingApprove(true)}
                  disabled={saving}
                >
                  Approve and publish
                </button>
              )}
            </div>
          )}
          {confirmingApprove && (
            <p className="form-hint" style={{ marginTop: "var(--space-sm)" }}>
              This will deliver the vote results to the Board and publish a
              "Vote results: …" post to the public feed. This cannot be undone.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page admin-briefs-page">
      <AdminTabs />
      <div className="admin-briefs-body">
        <h1>Briefs</h1>
        <p className="admin-subtitle">
          Review and approve the brief a process produces when it closes.
          Approval delivers it to the {hub.governing_body_name} and publishes
          it to the public feed. (Today this covers closed votes; other process
          types join as their briefs are built.)
        </p>

        <div className="admin-brief-filters">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`admin-brief-filter${statusFilter === f.id ? " is-active" : ""}`}
              onClick={() => setStatusFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading && <p>Loading…</p>}
        {error && <p className="form-error">{error}</p>}

        {!loading && !error && filtered.length === 0 && (
          <p className="empty-state-inline">
            {statusFilter === "all"
              ? "No vote results yet. Records are created automatically when votes close."
              : `No ${statusFilter} vote results.`}
          </p>
        )}

        <ul className="admin-proposal-list">
          {filtered.map((record) => (
            <li
              key={record.id}
              className="admin-proposal-item"
              onClick={() => openReview(record.id)}
            >
              <div className="admin-proposal-header">
                <h3>{record.title}</h3>
                <StatusChip status={record.publication_status} />
              </div>
              {record.vote_description_preview && (
                <p className="admin-vote-description-preview">
                  {record.vote_description_preview}
                  {record.vote_description_preview.length === 200 ? "…" : ""}
                </p>
              )}
              <div className="admin-proposal-meta">
                <span>{record.participation_count} votes</span>
                <span>Generated {formatDate(record.generated_at)}</span>
                {record.published_at && (
                  <span>Published {formatDate(record.published_at)}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: VoteResultsPublicationStatus }) {
  const cls = `status-badge admin-brief-status-${status}`;
  const label =
    status === "pending"
      ? "pending review"
      : status === "approved"
      ? "approved"
      : "published";
  return <span className={cls}>{label}</span>;
}

function parseCommentsText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} at ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

function formatVotingWindow(
  startsAt: string | null,
  endsAt: string | null,
): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  if (startsAt && endsAt) return `Voting was open from ${fmt(startsAt)} to ${fmt(endsAt)}.`;
  if (startsAt) return `Voting opened ${fmt(startsAt)}.`;
  if (endsAt) return `Voting closed ${fmt(endsAt)}.`;
  return "";
}
