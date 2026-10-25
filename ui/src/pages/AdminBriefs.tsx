import { useEffect, useState } from "react";
import BriefRegenerate from "../components/BriefRegenerate";
import { ClosedEarlyNote } from "../components/CloseEarly";
import { useNavigate, useParams } from "react-router-dom";
import {
  adminMarkQueueSeen,
  notifyAdminQueuesChanged,
  adminListBriefs,
  adminGetBrief,
  adminPatchBrief,
  adminApproveBrief,
  adminGetSettings,
  type BriefDetail,
  type BriefRecipient,
  type BriefSummary,
  type Official,
} from "../services/api";
import PostImagePicker from "../components/PostImagePicker";
import {
  ApproveActions,
  PublicationList,
  PublicationReview,
  StatusChip,
} from "../components/AdminPublicationReview";
import { useApi } from "../hooks/useApi";
import { parseCommentsText } from "../utils/commentsText";
import { useHub } from "../config/hub";
import {
  OFFICIAL_TYPES,
  OFFICIAL_TYPE_LABELS,
  normalizeOfficialType,
  type OfficialType,
} from "../../../src/shared/officialTypes";
// Reuse the vote-results admin styles — same layout language.
import "./AdminVoteResults.css";
import { manifestOf, typeName } from "../processes/display";
import { localShortDate, localDateAtTime } from "../utils/dates";

// Human labels for the source process type, shown as a small tag on each
// brief so the admin can tell a conversation brief from a vote brief.
function sourceLabel(type: string): string {
  // Only a type a brief is made for has a label here; anything else is a "Process".
  return manifestOf(type)?.descriptor.brief ? typeName(type) : "Process";
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
  const hub = useHub();
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id?: string }>();
  const view: "list" | "review" = routeId ? "review" : "list";

  // Opening this tab: its "new since you last looked" count clears.
  useEffect(() => {
    adminMarkQueueSeen("briefs").then(notifyAdminQueuesChanged).catch(() => {});
  }, []);

  const list = useApi<BriefSummary[]>("admin/briefs", () => adminListBriefs());
  // The brief named in the URL, read again whenever the id changes. Settings
  // ride along for the recipient picker: the officials roster (quick-add +
  // label matching) and the hub-wide recipient emails (prefill for a brief
  // whose selection was never made).
  const detail = useApi(routeId ? `admin/briefs/${routeId}` : null, async () => {
    const [record, settings] = await Promise.all([adminGetBrief(routeId!), adminGetSettings()]);
    return { record, settings };
  });
  const [selected, setSelectedState] = useState<BriefDetail | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Review form state, filled from each brief as it opens.
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
  const [loadedFrom, setLoadedFrom] = useState<typeof detail.data>(undefined);
  if (detail.data !== loadedFrom) {
    setLoadedFrom(detail.data);
    if (detail.data) {
      const { record, settings } = detail.data;
      setSelectedState(record);
      setHeadline(record.content.headline);
      setSummary(record.content.summary);
      setCommentsText(record.content.comments.join("\n"));
      setAdminNotes(record.content.admin_notes);
      setImageUrl(record.content.image_url ?? null);
      setImageAlt(record.content.image_alt ?? null);
      setRosterOfficials(settings.officials);
      setRecipients(record.recipients ?? prefillRecipients(settings.brief_recipient_emails, settings.officials));
      setConfirmingApprove(false);
    } else {
      setSelectedState(null);
    }
  }
  const setSelected = setSelectedState;

  const error = actionError ?? detail.error?.message ?? list.error?.message ?? null;

  function openReview(id: string) {
    setActionError(null);
    setActionMessage(null);
    navigate(`/admin/briefs/${id}`);
  }

  function backToList() {
    setConfirmingApprove(false);
    setActionMessage(null);
    setActionError(null);
    // The queue is read again: what was just approved shows as published.
    void list.reload();
    navigate("/admin/briefs");
  }

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
    setActionError(null);
    try {
      const updated = await adminPatchBrief(selected.id, buildPatch());
      setSelected(updated);
      setImageUrl(updated.content.image_url ?? null);
      setImageAlt(updated.content.image_alt ?? null);
      setActionMessage("Saved — the brief stays pending until you approve it.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function approve() {
    if (!selected) return;
    setApproving(true);
    setActionError(null);
    try {
      await adminPatchBrief(selected.id, buildPatch());
      const { brief, message } = await adminApproveBrief(selected.id);
      setSelected(brief);
      // The server's words: who it was emailed to, and who the hub's mode
      // held it back from ("Published. Not emailed to … because this hub is
      // in demo mode.").
      setActionMessage(message);
      setConfirmingApprove(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setApproving(false);
    }
  }

  if (view === "review" && selected) {
    const isPending = selected.publication_status === "pending";
    const c = selected.content;
    return (
      <PublicationReview
        title={selected.title}
        subtitle={
          <>
            <span className="status-badge admin-brief-source-tag">
              {sourceLabel(selected.source_process_type)}
            </span>{" "}
            Status: <StatusChip status={selected.publication_status} /> · Generated{" "}
            {localDateAtTime(selected.generated_at)}
          </>
        }
        backLabel="Back to Briefs"
        onBack={backToList}
        actionMessage={actionMessage}
        error={error}
        heldBack={selected.held_back}
        actions={
          <>
            {isPending && (
              <ApproveActions
                saveLabel="Save for later"
                saving={saving}
                approving={approving}
                confirming={confirmingApprove}
                onSave={saveDraft}
                onApprove={approve}
                onConfirm={() => setConfirmingApprove(true)}
                onCancel={() => setConfirmingApprove(false)}
              />
            )}
            {isPending && !confirmingApprove && (
              <p className="form-hint" style={{ marginTop: "var(--space-sm)" }}>
                Save for later keeps your edits and recipient selection without
                publishing. Approve and publish saves them too — no separate
                save needed.
              </p>
            )}
            {confirmingApprove && (
              <p className="form-hint" style={{ marginTop: "var(--space-sm)" }}>
                {recipients.length > 0
                  ? `This emails the brief to the ${recipients.length} selected recipient${recipients.length === 1 ? "" : "s"} and publishes it to the public feed. The published page will name them by their display labels. This cannot be undone.`
                  : "No recipients are selected — this publishes the brief to the public feed without an email delivery. This cannot be undone."}
              </p>
            )}
          </>
        }
      >
        {/* Closed before its deadline: the brief carries this as written. */}
        <ClosedEarlyNote closedEarly={selected.content.closed_early} />

        {/* Make it again; publish or discard a published brief's new version. */}
        <BriefRegenerate
          brief={selected}
          onBrief={(brief, message) => {
            setSelected(brief);
            setHeadline(brief.content.headline);
            setSummary(brief.content.summary);
            setCommentsText(brief.content.comments.join("\n"));
            setAdminNotes(brief.content.admin_notes);
            setImageUrl(brief.content.image_url ?? null);
            setImageAlt(brief.content.image_alt ?? null);
            setActionError(null);
            setActionMessage(message);
          }}
        />

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
              shown publicly. Use <strong>+ All …</strong> to add a whole
              office at once; those members are still emailed individually
              but appear on the public receipt as one office name. Leave
              the list empty to publish without an email delivery.
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
                  placeholder="Display label, e.g. Jane Doe, Town Council"
                  value={r.label}
                  onChange={(e) =>
                    setRecipients((prev) =>
                      prev.map((row, j) =>
                        j === i ? { ...row, label: e.target.value } : row,
                      ),
                    )
                  }
                />
                {r.group && (
                  <span
                    className="admin-recipient-group-chip"
                    title={`Shown on the public brief as "${r.group}", bundled with the rest of this office.`}
                  >
                    {r.group}
                  </span>
                )}
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
              {/* Whole-office quick-add. For every office type with two
                  or more people on the roster, one click adds all of its
                  members who aren't already picked, tagged with the
                  office name so the public receipt bundles them (all
                  supervisors → "Board of Supervisors" instead of five
                  names). Only offices with someone left to add appear. */}
              {OFFICIAL_TYPES.map((type) => {
                const members = rosterOfficials.filter(
                  (o) =>
                    (normalizeOfficialType(o.official_type) ??
                      ("other" as OfficialType)) === type,
                );
                const toAdd = members.filter(
                  (o) =>
                    !recipients.some(
                      (r) => r.email.toLowerCase() === o.email.toLowerCase(),
                    ),
                );
                if (members.length < 2 || toAdd.length === 0) return null;
                const groupName = OFFICIAL_TYPE_LABELS[type];
                return (
                  <button
                    key={`group-${type}`}
                    type="button"
                    className="admin-archive-button admin-recipient-group-add"
                    onClick={() =>
                      setRecipients((prev) => [
                        ...prev,
                        ...toAdd.map((o) => ({
                          email: o.email,
                          label: officialLabel(o),
                          group: groupName,
                        })),
                      ])
                    }
                  >
                    + All {groupName}
                  </button>
                );
              })}
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
                Sent {localDateAtTime(selected.delivered_at)}.
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

      </PublicationReview>
    );
  }

  return (
    <PublicationList
      heading="Briefs"
      intro={
        <>
          Review and approve the brief a process produces when it closes.
          Approval {hub.governing_body_short ? `delivers it to ${hub.governing_body_ref} and publishes it` : "publishes it"}
          to the public feed as the process's final result.
        </>
      }
      records={list.data ?? []}
      loading={list.loading}
      error={error}
      emptyAll="No briefs yet. A brief is created automatically when a process closes."
      emptyNoun="briefs"
      onOpen={openReview}
      row={(record) => (
        <>
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
            <span>Generated {localShortDate(record.generated_at)}</span>
            {record.published_at && <span>Published {localShortDate(record.published_at)}</span>}
          </div>
        </>
      )}
    />
  );
}
