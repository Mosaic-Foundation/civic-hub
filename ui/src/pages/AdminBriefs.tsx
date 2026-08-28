import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  adminListBriefs,
  adminGetBrief,
  adminPatchBrief,
  adminApproveBrief,
  adminGetSettings,
  type BriefDetail,
  type BriefPublicationStatus,
  type BriefRecipient,
  type BriefSummary,
  type Official,
} from "../services/api";
import AdminTabs from "../components/AdminTabs";
import PostImagePicker from "../components/PostImagePicker";
import hub from "../config/hub";
// Reuse the vote-results admin styles — same layout language.
import "./AdminVoteResults.css";

const STATUS_FILTERS: Array<{ id: "all" | BriefPublicationStatus; label: string }> = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "published", label: "Published" },
];

// Human labels for the source process type, shown as a small tag on each
// brief so the admin can tell a conversation brief from a vote brief.
const SOURCE_LABELS: Record<string, string> = {
  "civic.polis_deliberation": "Conversation",
  "civic.proposal": "Proposal",
  "civic.vote": "Vote",
  "civic.project": "Project",
};

function sourceLabel(type: string): string {
  return SOURCE_LABELS[type] ?? "Process";
}

/** Display label for a roster official: "Jane Doe, Board of Supervisors"
 *  (or just the office when no curated name exists). This becomes the
 *  public "Sent to …" text, so it must never be the email. */
function officialLabel(o: Official): string {
  const name = o.name?.trim();
  return name ? `${name}, ${o.official_title}` : o.official_title;
}

/**
 * Prefill for a brief whose recipients were never chosen: the hub-wide
 * recipient emails, labeled from the officials roster where they match.
 * Unmatched emails get an empty label the admin must fill before saving
 * — the server refuses a labelless recipient rather than leak the email
 * onto the public receipt.
 */
function prefillRecipients(
  globalEmails: string[],
  officials: Official[],
): BriefRecipient[] {
  const byEmail = new Map(
    officials.map((o) => [o.email.toLowerCase(), officialLabel(o)]),
  );
  return globalEmails.map((email) => ({
    email,
    label: byEmail.get(email.toLowerCase()) ?? "",
  }));
}

export default function AdminBriefs() {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id?: string }>();
  const view: "list" | "review" = routeId ? "review" : "list";

  const [records, setRecords] = useState<BriefSummary[]>([]);
  const [selected, setSelected] = useState<BriefDetail | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | BriefPublicationStatus>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Review form state
  const [headline, setHeadline] = useState("");
  const [summary, setSummary] = useState("");
  const [commentsText, setCommentsText] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageAlt, setImageAlt] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<BriefRecipient[]>([]);
  const [rosterOfficials, setRosterOfficials] = useState<Official[]>([]);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);

  function loadList() {
    setLoading(true);
    setError(null);
    adminListBriefs()
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
    navigate(`/admin/briefs/${id}`);
  }

  function backToList() {
    setConfirmingApprove(false);
    setActionMessage(null);
    setError(null);
    navigate("/admin/briefs");
  }

  useEffect(() => {
    if (!routeId) {
      setSelected(null);
      return;
    }
    setError(null);
    setActionMessage(null);
    // Settings ride along for the recipient picker: the officials roster
    // (quick-add + label matching) and the hub-wide recipient emails
    // (prefill for a brief whose selection was never made).
    Promise.all([adminGetBrief(routeId), adminGetSettings()])
      .then(([record, settings]) => {
        setSelected(record);
        setHeadline(record.content.headline);
        setSummary(record.content.summary);
        setCommentsText(record.content.comments.join("\n"));
        setAdminNotes(record.content.admin_notes);
        setImageUrl(record.content.image_url ?? null);
        setImageAlt(record.content.image_alt ?? null);
        setRosterOfficials(settings.officials);
        setRecipients(
          record.recipients ??
            prefillRecipients(settings.brief_recipient_emails, settings.officials),
        );
        setConfirmingApprove(false);
      })
      .catch((err: Error) => setError(err.message));
  }, [routeId]);

  function buildPatch() {
    const altTrimmed = (imageAlt ?? "").trim();
    return {
      headline,
      summary,
      comments: parseCommentsText(commentsText),
      admin_notes: adminNotes,
      image_url: imageUrl,
      image_alt: imageUrl && altTrimmed.length > 0 ? altTrimmed : null,
      recipients,
    };
  }

  async function saveDraft() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await adminPatchBrief(selected.id, buildPatch());
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
      await adminPatchBrief(selected.id, buildPatch());
      const { brief } = await adminApproveBrief(selected.id);
      setSelected(brief);
      const n = brief.delivered_to.length;
      setActionMessage(
        n > 0
          ? `Approved. Brief delivered to ${n} recipient(s) and published to the feed.`
          : "Approved and published to the feed.",
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
    const c = selected.content;
    return (
      <div className="page admin-briefs-page">
        <AdminTabs />
        <div className="admin-briefs-body">
          <button className="admin-back-link" onClick={backToList} type="button">
            &larr; Back to Briefs
          </button>
          <h1>Review: {selected.title}</h1>
          <p className="admin-subtitle">
            <span className="status-badge admin-brief-source-tag">
              {sourceLabel(selected.source_process_type)}
            </span>{" "}
            Status: <StatusChip status={selected.publication_status} /> · Generated{" "}
            {formatDateTime(selected.generated_at)}
          </p>

          {actionMessage && <p className="admin-action-message">{actionMessage}</p>}
          {error && <p className="form-error">{error}</p>}

          <section className="admin-detail-section">
            <h3>Headline</h3>
            <p className="form-hint">
              The one-line outcome shown at the top of the brief and on the feed
              card. Editable.
            </p>
            <input
              className="form-input"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              disabled={!isPending}
            />
          </section>

          <section className="admin-detail-section">
            <h3>Summary</h3>
            <p className="form-hint">
              The main readable outcome. Generated from the process; edit freely
              before publishing.
            </p>
            <textarea
              className="form-textarea"
              rows={6}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              disabled={!isPending}
            />
          </section>

          {c.participation_label && (
            <section className="admin-detail-section">
              <h3>Participation</h3>
              <p>{c.participation_label}</p>
            </section>
          )}

          {c.sections.length > 0 && (
            <section className="admin-detail-section">
              <h3>Detail</h3>
              <p className="form-hint">
                Snapshotted from the process outcome. Read-only.
              </p>
              {c.sections.map((s, i) => (
                <div key={i} className="admin-brief-section-block">
                  <h4>{s.heading}</h4>
                  <p style={{ whiteSpace: "pre-wrap" }}>{s.body}</p>
                </div>
              ))}
            </section>
          )}

          <section className="admin-detail-section">
            <h3>Community comments</h3>
            <p className="form-hint">
              One comment per line. Empty lines ignored; duplicates removed.
            </p>
            <textarea
              className="form-textarea"
              rows={5}
              value={commentsText}
              onChange={(e) => setCommentsText(e.target.value)}
              disabled={!isPending}
              placeholder="(none)"
            />
          </section>

          <section className="admin-detail-section">
            <h3>Notes from the Civic Hub</h3>
            <p className="form-hint">
              Optional admin-authored context delivered alongside the brief.
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
              Optional. Renders as the lead image on the published brief page
              and the feed card. JPEG, PNG, WebP, or GIF.
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

          {isPending && (
            <section className="admin-detail-section">
              <h3>Delivery recipients</h3>
              <p className="form-hint">
                Who receives this brief by email when you approve it. The{" "}
                <strong>display label</strong> is what the published page
                shows in its "Sent to …" receipt — email addresses are never
                shown publicly. Leave the list empty to publish without an
                email delivery.
              </p>
              {recipients.map((r, i) => (
                <div key={i} className="admin-recipient-row">
                  <input
                    className="form-input"
                    type="email"
                    placeholder="email@example.gov"
                    value={r.email}
                    onChange={(e) =>
                      setRecipients((prev) =>
                        prev.map((row, j) =>
                          j === i ? { ...row, email: e.target.value } : row,
                        ),
                      )
                    }
                  />
                  <input
                    className="form-input"
                    placeholder="Display label, e.g. Jane Doe, Board of Supervisors"
                    value={r.label}
                    onChange={(e) =>
                      setRecipients((prev) =>
                        prev.map((row, j) =>
                          j === i ? { ...row, label: e.target.value } : row,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="admin-cancel-button"
                    onClick={() =>
                      setRecipients((prev) => prev.filter((_, j) => j !== i))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              {recipients.length === 0 && (
                <p className="form-hint">
                  No recipients — the brief will publish to the feed without
                  an email delivery.
                </p>
              )}
              <div className="admin-recipient-actions">
                {rosterOfficials
                  .filter(
                    (o) =>
                      !recipients.some(
                        (r) => r.email.toLowerCase() === o.email.toLowerCase(),
                      ),
                  )
                  .map((o) => (
                    <button
                      key={o.email}
                      type="button"
                      className="admin-archive-button"
                      onClick={() =>
                        setRecipients((prev) => [
                          ...prev,
                          { email: o.email, label: officialLabel(o) },
                        ])
                      }
                    >
                      + {officialLabel(o)}
                    </button>
                  ))}
                <button
                  type="button"
                  className="admin-archive-button"
                  onClick={() =>
                    setRecipients((prev) => [...prev, { email: "", label: "" }])
                  }
                >
                  + Add by email
                </button>
              </div>
            </section>
          )}

          {selected.delivered_to.length > 0 && (
            <section className="admin-detail-section">
              <h3>Delivered</h3>
              {selected.delivered_at && (
                <p className="form-hint">
                  Sent {formatDateTime(selected.delivered_at)}.
                </p>
              )}
              <ul>
                {selected.delivered_to.map((r, i) => (
                  <li key={r}>
                    {r}
                    {selected.delivered_to_labels[i] && (
                      <> — shown publicly as "{selected.delivered_to_labels[i]}"</>
                    )}
                  </li>
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
              {recipients.length > 0
                ? `This emails the brief to the ${recipients.length} selected recipient${recipients.length === 1 ? "" : "s"} and publishes it to the public feed. The published page will name them by their display labels. This cannot be undone.`
                : "No recipients are selected — this publishes the brief to the public feed without an email delivery. This cannot be undone."}
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
          Approval delivers it to the {hub.governing_body_name} and publishes it
          to the public feed as the process's final result.
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
              ? "No briefs yet. A brief is created automatically when a process closes."
              : `No ${statusFilter} briefs.`}
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
                <h3>
                  <span className="status-badge admin-brief-source-tag">
                    {sourceLabel(record.source_process_type)}
                  </span>{" "}
                  {record.title}
                </h3>
                <StatusChip status={record.publication_status} />
              </div>
              {record.summary_preview && (
                <p className="admin-vote-description-preview">
                  {record.summary_preview}
                  {record.summary_preview.length === 200 ? "…" : ""}
                </p>
              )}
              <div className="admin-proposal-meta">
                {record.participation_count != null && (
                  <span>{record.participation_count} participants</span>
                )}
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

function StatusChip({ status }: { status: BriefPublicationStatus }) {
  const cls = `status-badge admin-brief-status-${status}`;
  const label =
    status === "pending" ? "pending review" : status === "approved" ? "approved" : "published";
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
