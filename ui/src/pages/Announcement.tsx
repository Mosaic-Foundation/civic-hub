import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  adminRemoveAnnouncement,
  adminRestoreAnnouncement,
  getAnnouncement,
  type Announcement,
} from "../services/api";
import { useAuth } from "../context/AuthContext";
import { relativeTime, absoluteTime } from "../components/FeedPost";
import PostFeaturedImage from "../components/PostFeaturedImage";
import LinkPreviewCard from "../components/LinkPreviewCard";
import ShareButton from "../components/ShareButton";
import Creator from "../components/Creator";
import AdminArchiveButton from "../components/AdminArchiveButton";
import "./Announcement.css";
import RelatedProcesses from "../components/RelatedProcesses";

const URL_RE = /\bhttps?:\/\/\S+/gi;

const REASON_CHIPS = [
  "Personal attack",
  "Harassment",
  "Doxxing",
  "Spam",
  "Other",
] as const;

export default function AnnouncementPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Slice 11 — admin moderation controls. The remove modal opens when
  // the admin clicks "Remove announcement" and stays mounted until the
  // request resolves (or the admin cancels).
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [removeReason, setRemoveReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [moderationError, setModerationError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    getAnnouncement(id)
      .then((a) => {
        if (cancelled) return;
        setAnnouncement(a);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="page announcement-page">
        <p className="announcement-status">Loading announcement…</p>
      </div>
    );
  }

  if (error || !announcement) {
    return (
      <div className="page announcement-page">
        <p className="announcement-status announcement-status-error">
          {error ?? "Announcement not found."}
        </p>
      </div>
    );
  }

  // Legacy Slice-4 announcements may have author_role === "board" —
  // normalize for display. Everything else renders verbatim.
  const roleLabel =
    announcement.author_role === "board" ? "Board member" : announcement.author_role;
  const isAdminLabel = roleLabel === "Admin";
  const canEdit = isAdmin || !!announcement.is_owner;
  const wasEdited = announcement.edit_count > 0;
  const isRemoved = !!announcement.moderation?.removed;

  async function handleRemoveSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    if (removeReason.trim().length === 0) {
      setModerationError("Please choose or enter a reason.");
      return;
    }
    setModerationError(null);
    setSubmitting(true);
    try {
      const updated = await adminRemoveAnnouncement(id, removeReason.trim());
      setAnnouncement(updated);
      setShowRemoveModal(false);
      setRemoveReason("");
    } catch (err) {
      setModerationError(
        err instanceof Error ? err.message : "Could not remove announcement",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRestore() {
    if (!id) return;
    setModerationError(null);
    try {
      const updated = await adminRestoreAnnouncement(id);
      setAnnouncement(updated);
    } catch (err) {
      setModerationError(
        err instanceof Error ? err.message : "Could not restore",
      );
    }
  }

  return (
    <article className="page announcement-page">
      <div className="process-share-row">
        <ShareButton
          title={announcement.title}
          shareText={announcement.title}
        />
      </div>

      <header className="announcement-header">
        <p className="announcement-eyebrow">
          {isAdminLabel ? "Announcement" : `${roleLabel} announcement`}
        </p>
        <h1>{announcement.title}</h1>
        <p className="announcement-meta">
          <Creator
            name={announcement.creator_name}
            isAdmin={announcement.creator_is_admin}
            prefix="Posted by"
          />{" "}
          <time
            dateTime={announcement.created_at}
            title={absoluteTime(announcement.created_at)}
          >
            {relativeTime(announcement.created_at)}
          </time>
          {wasEdited && announcement.last_edited_at && (
            <>
              {" · Last edited "}
              <time
                dateTime={announcement.last_edited_at}
                title={absoluteTime(announcement.last_edited_at)}
              >
                {relativeTime(announcement.last_edited_at)}
              </time>
            </>
          )}
          {canEdit && !isRemoved && (
            <>
              {" · "}
              <Link
                to={`/announcement/${announcement.id}/edit`}
                className="announcement-edit-link"
              >
                Edit
              </Link>
            </>
          )}
        </p>
      </header>

      {/* Slice 11 — admin moderation toolbar. Visible only to admins
          and only on the announcement detail page (not the feed card).
          Sits under the header so the admin can act without scrolling
          past the content. */}
      {isAdmin && (
        <div className="announcement-admin-toolbar" role="region" aria-label="Moderation">
          {isRemoved ? (
            <>
              <span>
                <strong>Removed</strong>
                {announcement.moderation?.reason && (
                  <> · {announcement.moderation.reason}</>
                )}
              </span>
              <button type="button" onClick={handleRestore}>
                Restore announcement
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setShowRemoveModal(true);
                  setRemoveReason("");
                  setModerationError(null);
                }}
              >
                Remove announcement
              </button>
              {/* Archive is distinct from a Code-of-Conduct removal: it hides
                  the announcement from the site and feed entirely (no
                  tombstone) for cleanup of stale content, and is restorable
                  from the admin Archived view. */}
              <AdminArchiveButton
                processId={announcement.id}
                itemLabel="announcement"
                onArchived={() => navigate("/")}
              />
            </>
          )}
          {moderationError && (
            <span className="form-error">{moderationError}</span>
          )}
        </div>
      )}

      {isRemoved ? (
        <p className="announcement-tombstone">
          This announcement was removed by a moderator for violating the{" "}
          <Link to="/code-of-conduct">Code of Conduct</Link>.
        </p>
      ) : (
        <>
          {announcement.image_url && (
            <PostFeaturedImage
              src={announcement.image_url}
              alt={announcement.image_alt ?? ""}
            />
          )}

          <div className="announcement-body">
            {announcement.body.split(/\n\n+/).map((para, i) => (
              <p key={i} className="announcement-paragraph">
                {para.split(/\n/).map((line, j, arr) => (
                  <span key={j}>
                    {line}
                    {j < arr.length - 1 && <br />}
                  </span>
                ))}
              </p>
            ))}
          </div>

          {(() => {
            // Render preview cards for any unique URL found in the body.
            const urls = Array.from(
              new Set(
                (announcement.body.match(URL_RE) ?? [])
                  .map((u) => u.replace(/[)\].,;!?]+$/, ""))
                  .filter((u) => u.length > 0),
              ),
            );
            if (urls.length === 0) return null;
            return (
              <section
                className="announcement-link-previews"
                aria-label="Linked previews"
              >
                {urls.map((u) => (
                  <LinkPreviewCard key={u} url={u} />
                ))}
              </section>
            );
          })()}

          {announcement.links.length > 0 && (
            <section className="announcement-links">
              <h2>Links</h2>
              <ul>
                {announcement.links.map((link, i) => (
                  <li key={i}>
                    <a href={link.url} target="_blank" rel="noopener noreferrer">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* Slice 11 — Remove-announcement modal. Reuses the intro-overlay
          shell + the chip pattern from the comment-hide modal. The
          reason is internal-audit only and stamps the moderation
          event's data.moderation.reason. */}
      {showRemoveModal && (
        <div
          className="intro-overlay"
          onClick={() => !submitting && setShowRemoveModal(false)}
        >
          <form
            className="intro-modal moderation-modal"
            onSubmit={handleRemoveSubmit}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Remove this announcement"
          >
            <h2 className="auth-title">Remove this announcement?</h2>
            <p className="auth-description">
              The announcement will be replaced with a tombstone for
              everyone. The reason is stored in the moderation audit
              log and is not shown to the public.
            </p>

            <div className="moderation-chips" role="list">
              {REASON_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  role="listitem"
                  className={`moderation-chip${removeReason === chip ? " is-active" : ""}`}
                  onClick={() => setRemoveReason(chip)}
                  disabled={submitting}
                >
                  {chip}
                </button>
              ))}
            </div>

            <label className="form-field">
              <span className="form-label">Reason (required)</span>
              <textarea
                className="form-input"
                value={removeReason}
                onChange={(e) => setRemoveReason(e.target.value)}
                maxLength={500}
                rows={3}
                disabled={submitting}
                placeholder="Brief description of the violation"
              />
            </label>

            {moderationError && (
              <p className="form-error">{moderationError}</p>
            )}

            <div className="moderation-modal-actions">
              <button
                type="submit"
                className="auth-continue-button"
                disabled={submitting || removeReason.trim().length === 0}
              >
                {submitting ? "Removing…" : "Remove announcement"}
              </button>
              <button
                type="button"
                className="auth-back-link"
                onClick={() => setShowRemoveModal(false)}
                disabled={submitting}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Read-only. A process may link TO this post, and the counter-link
          renders here so a reader can follow it back — but content posts
          never originate links of their own. */}
      <RelatedProcesses processId={id!} readOnly />
    </article>
  );
}
