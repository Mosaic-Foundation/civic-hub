import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Checkbox,
  dayFromToday,
  dayOf,
  endOfDay,
  PostImagePicker,
  refreshAside,
  useSpace,
  useViewer,
} from "@civic-social/plugin-sdk/ui";
import { URGENT_DEFAULT_DAYS, URGENT_MAX_DAYS } from "../board";
import {
  createAnnouncement,
  getAnnouncement,
  updateAnnouncement,
  type AnnouncementLink,
} from "./api";
import "./PostAnnouncement.css";

const TITLE_MAX = 200;
const BODY_MAX = 5000;
const LINKS_MAX = 5;

export default function PostAnnouncement() {
  const navigate = useNavigate();
  const { id: editId } = useParams<{ id?: string }>();
  const { isAdmin: viewerIsAdmin, mayPostForSpace: canPostAnnouncements, loading: authLoading } = useViewer();
  const space = useSpace();
  const tz = space.timeZone;

  const isEditMode = Boolean(editId);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [links, setLinks] = useState<AnnouncementLink[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageAlt, setImageAlt] = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(isEditMode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  // Urgent (any poster) and pinned (admins): src/shared/announcementBoard.ts.
  const [urgent, setUrgent] = useState(false);
  const [urgentUntil, setUrgentUntil] = useState(() => dayFromToday(URGENT_DEFAULT_DAYS, tz));
  const [pinned, setPinned] = useState(false);
  const [pinnedUntil, setPinnedUntil] = useState("");

  // Load the existing announcement when editing.
  useEffect(() => {
    if (!editId) return;
    setLoadingExisting(true);
    getAnnouncement(editId)
      .then((a) => {
        setTitle(a.title);
        setBody(a.body);
        setLinks(a.links);
        setImageUrl(a.image_url);
        setImageAlt(a.image_alt);
        setIsOwner(!!a.is_owner);
        setUrgent(!!a.urgent);
        if (a.urgent && a.urgent_until) setUrgentUntil(dayOf(a.urgent_until, tz));
        setPinned(!!a.pinned);
        setPinnedUntil(dayOf(a.pinned_until, tz));
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingExisting(false));
  }, [editId, tz]);

  // Gate: only Board or admin can reach the form at all. On edit, only the
  // original author or an admin can reach the form. Residents and
  // unauthenticated users get a clear message with a link home.
  if (authLoading) {
    return (
      <div className="page post-announcement-page">
        <p className="post-announcement-status">Loading…</p>
      </div>
    );
  }

  if (!canPostAnnouncements) {
    return (
      <div className="page post-announcement-page">
        <Link to="/" className="back-link">
          &larr; Home
        </Link>
        <h1>Not available</h1>
        <p>
          Only officials and admins can post announcements. If you believe
          this is a mistake, contact the hub administrator.
        </p>
      </div>
    );
  }

  if (isEditMode) {
    if (loadingExisting) {
      return (
        <div className="page post-announcement-page">
          <p className="post-announcement-status">Loading announcement…</p>
        </div>
      );
    }
    const isAdmin = viewerIsAdmin;
    if (!isAdmin && !isOwner) {
      return (
        <div className="page post-announcement-page">
          <Link to={`/announcement/${editId}`} className="back-link">
            &larr; Back to announcement
          </Link>
          <h1>Not your announcement</h1>
          <p>
            Officials can only edit announcements they posted. If a
            correction is needed, ask an admin.
          </p>
        </div>
      );
    }
  }

  const isAdminRole = viewerIsAdmin;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const cleanedLinks = links
      .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
      .filter((l) => l.label.length > 0 || l.url.length > 0);

    // Image fields: send `null` (not undefined) to clear an existing
    // image on edit, or a string to set/replace. Alt text is optional;
    // the picker hints toward adding it for accessibility but doesn't
    // block submission when empty.
    setSubmitting(true);
    try {
      const altToSend = imageUrl
        ? ((imageAlt ?? "").trim().length > 0 ? imageAlt!.trim() : null)
        : null;
      const marks = {
        urgent,
        urgent_until: urgent ? endOfDay(urgentUntil, tz) : null,
        // Only an admin sends pinned: the server refuses it from anyone else.
        ...(isAdminRole ? { pinned, pinned_until: pinned ? endOfDay(pinnedUntil, tz) : null } : {}),
      };
      if (isEditMode && editId) {
        await updateAnnouncement(editId, {
          title: title.trim(),
          body: body.trim(),
          links: cleanedLinks,
          image_url: imageUrl,
          image_alt: altToSend,
          ...marks,
        });
        refreshAside();
        navigate(`/announcement/${editId}`);
      } else {
        const created = await createAnnouncement({
          title: title.trim(),
          body: body.trim(),
          links: cleanedLinks,
          image_url: imageUrl,
          image_alt: altToSend,
          ...marks,
        });
        refreshAside();
        navigate(`/announcement/${created.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  function updateLink(i: number, patch: Partial<AnnouncementLink>) {
    setLinks((cur) =>
      cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    );
  }

  function addLink() {
    if (links.length >= LINKS_MAX) return;
    setLinks((cur) => [...cur, { label: "", url: "" }]);
  }

  function removeLink(i: number) {
    setLinks((cur) => cur.filter((_, idx) => idx !== i));
  }

  const titleOver = title.length > TITLE_MAX;
  const bodyOver = body.length > BODY_MAX;
  const canSubmit =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    !titleOver &&
    !bodyOver &&
    !(urgent && !urgentUntil) &&
    !submitting;

  return (
    <div className="page post-announcement-page">
      <Link
        to={isEditMode && editId ? `/announcement/${editId}` : "/"}
        className="back-link"
      >
        &larr; {isEditMode ? "Back to announcement" : "Home"}
      </Link>
      <h1>{isEditMode ? "Edit announcement" : "Post an announcement"}</h1>
      <p className="post-announcement-lede">
        {isEditMode
          ? "Changes are logged. The announcement page will show an \"edited\" timestamp."
          : "Announcements publish immediately and appear in the public feed. One-way — people can read but not reply."}
      </p>

      <form onSubmit={handleSubmit} className="post-announcement-form">
        <div className="form-field">
          <label className="form-label">
            Featured image <span className="optional">(optional)</span>
          </label>
          <PostImagePicker
            imageUrl={imageUrl}
            imageAlt={imageAlt}
            onChange={({ image_url, image_alt }) => {
              setImageUrl(image_url);
              setImageAlt(image_alt);
            }}
            disabled={submitting}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="announcement-title">
            Title <span className="required">*</span>
          </label>
          <input
            id="announcement-title"
            className="form-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
            maxLength={TITLE_MAX}
            placeholder="Short, specific — e.g. 'Regular meeting moved to April 29'"
            disabled={submitting}
          />
          <span className="form-counter">
            {title.length} / {TITLE_MAX}
          </span>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="announcement-body">
            Body <span className="required">*</span>
          </label>
          <textarea
            id="announcement-body"
            className="form-textarea"
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, BODY_MAX))}
            maxLength={BODY_MAX}
            rows={10}
            placeholder="Plain text. Line breaks are preserved. Add links below as separate label + URL rows."
            disabled={submitting}
          />
          <span className="form-counter">
            {body.length} / {BODY_MAX}
          </span>
        </div>

        <div className="form-field">
          <label className="form-label">Links <span className="optional">(optional)</span></label>
          <p className="form-hint">
            Up to {LINKS_MAX} labeled links appear below the announcement body.
          </p>
          {links.map((link, i) => (
            <div key={i} className="announcement-link-row">
              <input
                className="form-input"
                type="text"
                value={link.label}
                onChange={(e) => updateLink(i, { label: e.target.value })}
                placeholder="Link label"
                disabled={submitting}
              />
              <input
                className="form-input"
                type="url"
                value={link.url}
                onChange={(e) => updateLink(i, { url: e.target.value })}
                placeholder="https://…"
                disabled={submitting}
              />
              <button
                type="button"
                className="announcement-link-remove"
                onClick={() => removeLink(i)}
                disabled={submitting}
                aria-label={`Remove link ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
          {links.length < LINKS_MAX && (
            <button
              type="button"
              className="announcement-link-add"
              onClick={addLink}
              disabled={submitting}
            >
              + Add link
            </button>
          )}
        </div>

        <fieldset className="form-field announcement-marks">
          <legend className="form-label">Prominence</legend>
          <Checkbox
            label="Mark as urgent"
            hint="Shows a red Urgent label on the post, and a line across the top of the hub's pages, until the end of the date below. For a fire ban, a road closure, a boil-water notice."
            checked={urgent}
            onChange={(e) => setUrgent(e.target.checked)}
            disabled={submitting}
          />
          {urgent && (
            <label className="announcement-mark-date">
              Urgent until
              <input
                className="form-input"
                type="date"
                value={urgentUntil}
                min={dayFromToday(0, tz)}
                max={dayFromToday(URGENT_MAX_DAYS, tz)}
                onChange={(e) => setUrgentUntil(e.target.value)}
                required
                disabled={submitting}
              />
            </label>
          )}
          {isAdminRole && (
            <>
              <Checkbox
                label="Pin to the Announcements card"
                hint="Keeps it in the right column's Announcements card until you unpin it or the end date passes. Admins only."
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
                disabled={submitting}
              />
              {pinned && (
                <label className="announcement-mark-date">
                  Pinned until <span className="optional">(optional)</span>
                  <input
                    className="form-input"
                    type="date"
                    value={pinnedUntil}
                    min={dayFromToday(0, tz)}
                    onChange={(e) => setPinnedUntil(e.target.value)}
                    disabled={submitting}
                  />
                </label>
              )}
            </>
          )}
        </fieldset>

        {error && <p className="form-error">{error}</p>}

        <div className="post-announcement-actions">
          <button
            type="submit"
            className="post-announcement-submit"
            disabled={!canSubmit}
          >
            {submitting
              ? isEditMode
                ? "Saving…"
                : "Posting…"
              : isEditMode
                ? "Save changes"
                : "Post announcement"}
          </button>
        </div>
      </form>
    </div>
  );
}
