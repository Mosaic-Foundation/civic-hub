import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  adminListVoteResults,
  adminGetVoteResults,
  adminPatchVoteResults,
  adminApproveVoteResults,
  type VoteResultsDetail,
  type VoteResultsSummary,
} from "../services/api";
import PostImagePicker from "../components/PostImagePicker";
import {
  ApproveActions,
  PublicationList,
  PublicationReview,
  StatusChip,
} from "../components/AdminPublicationReview";
import { parseCommentsText } from "../utils/commentsText";
import { useApi } from "../hooks/useApi";
import { useHub } from "../config/hub";
import "./AdminVoteResults.css";
import { localShortDate, localDateAtTime } from "../utils/dates";

export default function AdminVoteResults() {
  const hub = useHub();
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id?: string }>();
  const view: "list" | "review" = routeId ? "review" : "list";

  const list = useApi<VoteResultsSummary[]>("admin/vote-results", () => adminListVoteResults());
  // The record named in the URL, read again whenever the id changes.
  const detail = useApi<VoteResultsDetail>(routeId ? `admin/vote-results/${routeId}` : null, () => adminGetVoteResults(routeId!));
  const selected = detail.data ?? null;
  const setSelected = detail.setData;

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Review form state, filled from each record as it opens.
  const [commentsText, setCommentsText] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageAlt, setImageAlt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [formFor, setFormFor] = useState<string | null>(null);
  if (selected && formFor !== selected.id) {
    setFormFor(selected.id);
    setCommentsText(selected.content.comments.join("\n"));
    setAdminNotes(selected.content.admin_notes);
    setImageUrl(selected.content.image_url ?? null);
    setImageAlt(selected.content.image_alt ?? null);
    setConfirmingApprove(false);
  }

  const error = actionError ?? detail.error?.message ?? list.error?.message ?? null;

  function openReview(id: string) {
    setActionError(null);
    setActionMessage(null);
    navigate(`/admin/vote-results/${id}`);
  }

  function backToList() {
    setConfirmingApprove(false);
    setActionMessage(null);
    setActionError(null);
    // The queue is read again: what was just approved shows as published.
    void list.reload();
    navigate("/admin/vote-results");
  }

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
    setActionError(null);
    try {
      const updated = await adminPatchVoteResults(selected.id, buildPatch());
      setSelected(updated);
      setImageUrl(updated.content.image_url ?? null);
      setImageAlt(updated.content.image_alt ?? null);
      setActionMessage("Draft saved.");
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
      // Save any unsaved edits first so the published record matches
      // what the admin is looking at.
      await adminPatchVoteResults(selected.id, buildPatch());
      const { vote_results, message } = await adminApproveVoteResults(selected.id);
      setSelected(vote_results);
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
    const ctx = selected.content.vote_context;
    return (
      <PublicationReview
        title={selected.title}
        subtitle={
          <>
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
                saveLabel="Save draft"
                saving={saving}
                approving={approving}
                confirming={confirmingApprove}
                onSave={saveDraft}
                onApprove={approve}
                onConfirm={() => setConfirmingApprove(true)}
                onCancel={() => setConfirmingApprove(false)}
              />
            )}
            {confirmingApprove && (
              <p className="form-hint" style={{ marginTop: "var(--space-sm)" }}>
                This will deliver the vote results to {hub.governing_body_ref} and publish a
                "Vote results: …" post to the public feed. This cannot be undone.
              </p>
            )}
          </>
        }
      >
        <section className="admin-detail-section">
          <h3>Participation</h3>
          <p>
            {selected.content.participation_count}{" "}
            {hub.noun(selected.content.participation_count)} voted.
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
            surfacing to {hub.governing_body_ref}.
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

      </PublicationReview>
    );
  }

  return (
    <PublicationList
      heading="Briefs"
      intro={
        <>
          Review and approve the brief a process produces when it closes.
          Approval {hub.governing_body_short ? `delivers it to ${hub.governing_body_ref} and publishes` : "publishes"}
          it to the public feed. (Today this covers closed votes; other process
          types join as their briefs are built.)
        </>
      }
      records={list.data ?? []}
      loading={list.loading}
      error={error}
      emptyAll="No vote results yet. Records are created automatically when votes close."
      emptyNoun="vote results"
      onOpen={openReview}
      row={(record) => (
        <>
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
            <span>Generated {localShortDate(record.generated_at)}</span>
            {record.published_at && <span>Published {localShortDate(record.published_at)}</span>}
          </div>
        </>
      )}
    />
  );
}

function formatVotingWindow(
  startsAt: string | null,
  endsAt: string | null,
): string {
  const fmt = localShortDate;
  if (startsAt && endsAt) return `Voting was open from ${fmt(startsAt)} to ${fmt(endsAt)}.`;
  if (startsAt) return `Voting opened ${fmt(startsAt)}.`;
  if (endsAt) return `Voting closed ${fmt(endsAt)}.`;
  return "";
}
