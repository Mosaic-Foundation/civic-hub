import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  adminApproveMeetingSummary,
  adminBatchApproveMeetingSummaries,
  adminBatchDeleteMeetingSummaries,
  adminCleanupOrphanedEvents,
  adminGetMeetingSummary,
  adminListMeetingSummaries,
  adminPatchMeetingSummary,
  type MeetingSummaryApprovalStatus,
  type MeetingSummaryDetail,
  type MeetingSummarySummary,
  type SummaryBlock,
} from "../services/api";
import AdminTabs from "../components/AdminTabs";
import hub from "../config/hub";
import "./AdminMeetingSummaries.css";

const STATUS_FILTERS: Array<{
  id: "all" | MeetingSummaryApprovalStatus;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "published", label: "Published" },
];

export default function AdminMeetingSummaries() {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id?: string }>();
  const view: "list" | "review" = routeId ? "review" : "list";

  const [summaries, setSummaries] = useState<MeetingSummarySummary[]>([]);
  const [selected, setSelected] = useState<MeetingSummaryDetail | null>(null);
  const [statusFilter, setStatusFilter] =
    useState<"all" | MeetingSummaryApprovalStatus>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Batch selection state
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [confirmBatchAction, setConfirmBatchAction] = useState<
    "approve" | "delete" | null
  >(null);
  const [backdateBatch, setBackdateBatch] = useState(true);

  // Review form state
  const [meetingTitle, setMeetingTitle] = useState("");
  const [blocks, setBlocks] = useState<SummaryBlock[]>([]);
  const [adminNotes, setAdminNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);

  function loadList() {
    setLoading(true);
    setError(null);
    adminListMeetingSummaries()
      .then(setSummaries)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // List loads on every transition to list view (initial mount with no
  // routeId, plus any back-from-review navigation). Without this, the
  // status of a just-approved summary still reads "pending" in the list
  // until the user manually refreshes.

  const filtered = useMemo(() => {
    if (statusFilter === "all") return summaries;
    return summaries.filter((s) => s.approval_status === statusFilter);
  }, [summaries, statusFilter]);

  const pendingFiltered = useMemo(
    () => filtered.filter((s) => s.approval_status === "pending"),
    [filtered],
  );

  function toggleChecked(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    const allChecked = filtered.every((s) => checkedIds.has(s.id));
    if (allChecked) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(filtered.map((s) => s.id)));
    }
  }

  async function executeBatchAction(action: "approve" | "delete") {
    const ids = Array.from(checkedIds);
    if (ids.length === 0) return;
    setBatchBusy(true);
    setError(null);
    setConfirmBatchAction(null);
    try {
      if (action === "approve") {
        const result = await adminBatchApproveMeetingSummaries(ids, {
          backdate: backdateBatch,
        });
        setActionMessage(
          `Approved ${result.published} summary${result.published !== 1 ? "ies" : ""}.` +
            (result.failed > 0 ? ` ${result.failed} failed.` : ""),
        );
      } else {
        const result = await adminBatchDeleteMeetingSummaries(ids);
        const n = result.archived ?? result.deleted;
        setActionMessage(
          `Archived ${n} summary${n !== 1 ? "ies" : ""}. Restore from the Archived tab.`,
        );
      }
      setCheckedIds(new Set());
      loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch action failed");
    } finally {
      setBatchBusy(false);
    }
  }

  function openReview(id: string) {
    setError(null);
    setActionMessage(null);
    navigate(`/admin/meeting-summaries/${id}`);
  }

  function backToList() {
    setConfirmingApprove(false);
    setActionMessage(null);
    setError(null);
    navigate("/admin/meeting-summaries");
  }

  useEffect(() => {
    if (!routeId) {
      setSelected(null);
      // Refresh the list whenever we return to it (or land on it
      // initially). Picks up any approval / publication that happened
      // in the review view we're returning from.
      loadList();
      return;
    }
    setError(null);
    setActionMessage(null);
    adminGetMeetingSummary(routeId)
      .then((detail) => {
        setSelected(detail);
        setMeetingTitle(detail.meeting_title);
        setBlocks(detail.blocks);
        setAdminNotes(detail.admin_notes);
        setConfirmingApprove(false);
      })
      .catch((err: Error) => setError(err.message));
  }, [routeId]);

  function updateBlock(index: number, patch: Partial<SummaryBlock>) {
    setBlocks((prev) =>
      prev.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    );
  }

  function moveBlock(index: number, direction: -1 | 1) {
    setBlocks((prev) => {
      const j = index + direction;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  function deleteBlock(index: number) {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  }

  function addBlock() {
    setBlocks((prev) => [
      ...prev,
      {
        topic_title: "",
        topic_summary: "",
        start_time_seconds: null,
        action_taken: null,
      },
    ]);
  }

  async function saveDraft() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await adminPatchMeetingSummary(selected.id, {
        meeting_title: meetingTitle,
        blocks,
        admin_notes: adminNotes,
      });
      setSelected(updated);
      setMeetingTitle(updated.meeting_title);
      setBlocks(updated.blocks);
      setAdminNotes(updated.admin_notes);
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
      await adminPatchMeetingSummary(selected.id, {
        meeting_title: meetingTitle,
        blocks,
        admin_notes: adminNotes,
      });
      const { meeting_summary } = await adminApproveMeetingSummary(selected.id);
      setSelected(meeting_summary);
      setMeetingTitle(meeting_summary.meeting_title);
      setBlocks(meeting_summary.blocks);
      setAdminNotes(meeting_summary.admin_notes);
      setActionMessage("Approved. Summary is now live on the public feed.");
      setConfirmingApprove(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setApproving(false);
    }
  }

  if (view === "review" && selected) {
    const isPending = selected.approval_status === "pending";
    return (
      <div className="page admin-meeting-summaries-page">
        <AdminTabs />
        <div className="admin-meeting-summaries-body">
          <button
            className="admin-back-link"
            onClick={backToList}
            type="button"
          >
            &larr; Back to Meeting summaries
          </button>
          <h1>
            Review: {selected.meeting_title} — {formatDate(selected.meeting_date)}
          </h1>
          <p className="admin-subtitle">
            Status: <StatusChip status={selected.approval_status} /> · Generated{" "}
            {formatDateTime(selected.generated_at)}
          </p>

          <div className="meeting-ai-banner">
            <strong>AI-generated, admin-reviewed.</strong> This summary was
            produced by an AI model from the minutes PDF
            {selected.source_video_url ? " and YouTube auto-transcript" : ""}.
            It is not an authoritative transcript. Review every block before
            approving.
          </div>

          {actionMessage && (
            <p className="admin-action-message">{actionMessage}</p>
          )}
          {error && <p className="form-error">{error}</p>}

          {selected.source_type === "agenda" && (
            <div className="meeting-ai-banner" style={{ borderLeftColor: "#d97706" }}>
              <strong style={{ color: "#d97706" }}>Agenda-based summary.</strong> This
              summary was generated from the meeting agenda (not official minutes).
              It will be automatically upgraded when minutes are posted.
            </div>
          )}

          {selected.source_type === "recording" && (
            <div className="meeting-ai-banner" style={{ borderLeftColor: "#d97706" }}>
              <strong style={{ color: "#d97706" }}>Recording-based summary.</strong> This
              summary was generated from the meeting's automatic video transcript — there
              was no agenda or minutes document to work from. Automatic transcripts
              mishear names and figures, so check those closely. It will be upgraded
              automatically if minutes are posted for this date.
            </div>
          )}

          <section className="admin-detail-section">
            <h3>Source</h3>
            <ul className="meeting-source-list">
              {selected.source_minutes_url ? (
                <li>
                  <strong>Minutes PDF:</strong>{" "}
                  <a
                    href={selected.source_minutes_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {selected.source_minutes_url}
                  </a>
                </li>
              ) : (
                <li>
                  <strong>Minutes PDF:</strong> not yet posted
                </li>
              )}
              {selected.source_agenda_url && (
                <li>
                  <strong>Agenda PDF:</strong>{" "}
                  <a
                    href={selected.source_agenda_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {selected.source_agenda_url}
                  </a>
                </li>
              )}
              {selected.source_video_url ? (
                <li>
                  <strong>Primary recording:</strong>{" "}
                  <a
                    href={selected.source_video_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {selected.source_video_url}
                  </a>
                </li>
              ) : (
                <li>
                  <strong>Video recording:</strong> none available
                </li>
              )}
              {selected.additional_video_urls.length > 0 && (
                <li>
                  <strong>Additional recordings:</strong>
                  <ul>
                    {selected.additional_video_urls.map((url) => (
                      <li key={url}>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </li>
              )}
              <li>
                <strong>Model:</strong> {selected.ai_model}
              </li>
            </ul>
          </section>

          <section className="admin-detail-section">
            <h3>Meeting title</h3>
            <input
              type="text"
              className="form-input"
              value={meetingTitle}
              onChange={(e) => setMeetingTitle(e.target.value)}
              disabled={!isPending}
              placeholder={`${hub.governing_body_name} Regular Meeting`}
            />
          </section>

          <section className="admin-detail-section">
            <h3>Topic blocks</h3>
            <p className="form-hint">
              Edit titles, summaries, and timestamps inline. Reorder with
              the up/down buttons. Add or delete blocks as needed. Timestamps
              are in seconds from the start of the video.
            </p>
            {blocks.length === 0 && (
              <p className="empty-state-inline">
                No blocks. Click "Add block" to create one.
              </p>
            )}
            <ol className="meeting-block-list">
              {blocks.map((block, i) => (
                <li key={i} className="meeting-block-row">
                  <div className="meeting-block-actions">
                    <button
                      type="button"
                      onClick={() => moveBlock(i, -1)}
                      disabled={!isPending || i === 0}
                      aria-label="Move up"
                    >
                      &uarr;
                    </button>
                    <button
                      type="button"
                      onClick={() => moveBlock(i, 1)}
                      disabled={!isPending || i === blocks.length - 1}
                      aria-label="Move down"
                    >
                      &darr;
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteBlock(i)}
                      disabled={!isPending}
                      className="meeting-block-delete"
                      aria-label="Delete block"
                    >
                      &times;
                    </button>
                  </div>
                  <label className="meeting-block-field">
                    <span>Topic title</span>
                    <input
                      type="text"
                      className="form-input"
                      value={block.topic_title}
                      onChange={(e) =>
                        updateBlock(i, { topic_title: e.target.value })
                      }
                      disabled={!isPending}
                    />
                  </label>
                  <label className="meeting-block-field">
                    <span>Summary</span>
                    <textarea
                      className="form-textarea"
                      rows={3}
                      value={block.topic_summary}
                      onChange={(e) =>
                        updateBlock(i, { topic_summary: e.target.value })
                      }
                      disabled={!isPending}
                    />
                  </label>
                  <div className="meeting-block-field meeting-block-field-inline">
                    <label className="meeting-block-field">
                      <span>Timestamp (HH:MM:SS)</span>
                      <input
                        type="text"
                        className="form-input"
                        value={
                          block.start_time_seconds === null
                            ? ""
                            : formatSeconds(block.start_time_seconds)
                        }
                        onChange={(e) =>
                          updateBlock(i, {
                            start_time_seconds: parseTimeInput(e.target.value),
                          })
                        }
                        disabled={!isPending || !selected.source_video_url}
                        placeholder={
                          selected.source_video_url ? "00:00:00" : "n/a"
                        }
                      />
                    </label>
                    {block.start_time_seconds !== null &&
                      selected.source_video_url && (
                        <a
                          className="meeting-block-watch-link"
                          href={youTubeAtTime(
                            selected.source_video_url,
                            block.start_time_seconds,
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open at this moment ↗
                        </a>
                      )}
                  </div>
                  <label className="meeting-block-field">
                    <span>Action taken (optional)</span>
                    <input
                      type="text"
                      className="form-input"
                      value={block.action_taken ?? ""}
                      onChange={(e) =>
                        updateBlock(i, {
                          action_taken:
                            e.target.value.trim().length === 0
                              ? null
                              : e.target.value,
                        })
                      }
                      disabled={!isPending}
                      placeholder="(none)"
                    />
                  </label>
                </li>
              ))}
            </ol>
            {isPending && (
              <button
                type="button"
                className="admin-archive-button"
                onClick={addBlock}
              >
                + Add block
              </button>
            )}
          </section>

          <section className="admin-detail-section">
            <h3>Admin notes</h3>
            <p className="form-hint">
              Optional context shown on the public summary page below the
              topic blocks.
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
            <p
              className="form-hint"
              style={{ marginTop: "var(--space-sm)" }}
            >
              This will publish a "Meeting summary" post to the public feed
              and make the summary visible at{" "}
              <code>/meeting-summary/{selected.id}</code>. This cannot be
              undone.
            </p>
          )}

          {/* Foot-of-page back link — review forms can run long, and
              scrolling all the way back to the top to leave the page is
              friction admins don't need. */}
          <div style={{ marginTop: "var(--space-xl)" }}>
            <button
              className="admin-back-link"
              onClick={backToList}
              type="button"
            >
              &larr; Back to Meeting summaries
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page admin-meeting-summaries-page">
      <AdminTabs />
      <div className="admin-meeting-summaries-body">
        <h1>Meeting summaries</h1>
        <p className="admin-subtitle">
          AI-generated summaries of {hub.governing_body_name} meetings.
          Review topic blocks and approve to publish to the public feed.
        </p>

        <div className="admin-brief-filters">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`admin-brief-filter${
                statusFilter === f.id ? " is-active" : ""
              }`}
              onClick={() => setStatusFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading && <p>Loading…</p>}
        {error && <p className="form-error">{error}</p>}
        {actionMessage && (
          <p className="admin-action-message">{actionMessage}</p>
        )}

        <button
          type="button"
          className="admin-cancel-button"
          style={{ fontSize: "var(--font-size-sm)", marginBottom: "var(--space-md)" }}
          onClick={async () => {
            try {
              const result = await adminCleanupOrphanedEvents();
              setActionMessage(result.message);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Cleanup failed");
            }
          }}
        >
          Clean up orphaned feed entries
        </button>

        {filtered.length > 0 && (
          <div className="batch-bar">
            <label className="batch-select-all">
              <input
                type="checkbox"
                checked={
                  filtered.length > 0 &&
                  filtered.every((s) => checkedIds.has(s.id))
                }
                onChange={toggleAllVisible}
                disabled={batchBusy}
              />
              Select all ({filtered.length})
            </label>
            {checkedIds.size > 0 && (
              <span className="batch-actions">
                {confirmBatchAction ? (
                  <>
                    <span className="batch-confirm-label">
                      {confirmBatchAction === "approve"
                        ? `Approve ${checkedIds.size} selected?`
                        : `Archive ${checkedIds.size} selected? They can be restored from the Archived tab.`}
                    </span>
                    {confirmBatchAction === "approve" && (
                      <label className="batch-backdate-label">
                        <input
                          type="checkbox"
                          checked={backdateBatch}
                          onChange={(e) => setBackdateBatch(e.target.checked)}
                          disabled={batchBusy}
                        />
                        Post with meeting dates
                      </label>
                    )}
                    <button
                      type="button"
                      className={
                        confirmBatchAction === "approve"
                          ? "admin-convert-button"
                          : "batch-delete-button"
                      }
                      onClick={() => executeBatchAction(confirmBatchAction)}
                      disabled={batchBusy}
                    >
                      {batchBusy ? "Working…" : "Confirm"}
                    </button>
                    <button
                      type="button"
                      className="admin-cancel-button"
                      onClick={() => setConfirmBatchAction(null)}
                      disabled={batchBusy}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    {pendingFiltered.length > 0 && checkedIds.size > 0 && (
                      <button
                        type="button"
                        className="admin-convert-button"
                        onClick={() => setConfirmBatchAction("approve")}
                        disabled={batchBusy}
                      >
                        Approve selected ({checkedIds.size})
                      </button>
                    )}
                    <button
                      type="button"
                      className="batch-delete-button"
                      onClick={() => setConfirmBatchAction("delete")}
                      disabled={batchBusy}
                    >
                      Archive selected ({checkedIds.size})
                    </button>
                  </>
                )}
              </span>
            )}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <p className="empty-state-inline">
            {statusFilter === "all"
              ? "No meeting summaries yet. Summaries are created daily by the cron job."
              : `No ${statusFilter} summaries.`}
          </p>
        )}

        <ul className="admin-proposal-list">
          {filtered.map((s) => (
            <li
              key={s.id}
              className="admin-proposal-item"
            >
              <div className="admin-proposal-header">
                <input
                  type="checkbox"
                  className="batch-checkbox"
                  checked={checkedIds.has(s.id)}
                  onChange={() => toggleChecked(s.id)}
                  onClick={(e) => e.stopPropagation()}
                  disabled={batchBusy}
                />
                <h3
                  className="admin-proposal-title-link"
                  onClick={() => openReview(s.id)}
                >
                  {s.meeting_title} — {formatDate(s.meeting_date)}
                </h3>
                <StatusChip status={s.approval_status} />
              </div>
              <div
                className="admin-proposal-meta"
                onClick={() => openReview(s.id)}
              >
                <span>{s.block_count} blocks</span>
                {s.source_type === "agenda" && (
                  <span className="badge-agenda">Agenda-only</span>
                )}
                {s.source_type === "recording" && (
                  <span className="badge-agenda">Transcript-only</span>
                )}
                {!s.has_video && s.source_type !== "recording" && (
                  <span>PDF-only</span>
                )}
                <span>Generated {formatDate(s.generated_at)}</span>
                {s.published_at && (
                  <span>Published {formatDate(s.published_at)}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: MeetingSummaryApprovalStatus }) {
  const cls = `status-badge admin-brief-status-${status}`;
  const label =
    status === "pending"
      ? "pending review"
      : status === "approved"
      ? "approved"
      : "published";
  return <span className={cls}>{label}</span>;
}

function formatDate(iso: string): string {
  // Accepts either a date-only (YYYY-MM-DD) or a full timestamp. new Date
  // on a date-only string is interpreted as UTC, which can shift the day
  // backward when formatted in local TZ — paper over with a noon-time
  // constructor when no T is present.
  const d = iso.includes("T") ? new Date(iso) : new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })} at ${d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function formatSeconds(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function youTubeAtTime(watchUrl: string, seconds: number): string {
  try {
    const u = new URL(watchUrl);
    u.searchParams.set("t", `${Math.max(0, Math.floor(seconds))}s`);
    return u.toString();
  } catch {
    return watchUrl;
  }
}

/** Parse HH:MM:SS, MM:SS, or plain seconds. Returns null on empty. */
function parseTimeInput(raw: string): number | null {
  const t = raw.trim();
  if (t.length === 0) return null;
  const parts = t.split(":").map((p) => p.trim());
  if (parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.length === 1) return nums[0];
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  return null;
}
