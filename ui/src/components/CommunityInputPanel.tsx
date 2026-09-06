// CommunityInputPanel — renders the community comments collected via
// civic.input for a process.
//
// Read-only as of Slice 3.5 for residents. Admins (Slice 11) get inline
// "Hide" controls on each comment plus a "Restore" affordance on
// already-hidden tombstones.
//
// Tombstone semantics: residents see "This comment was removed by a
// moderator..." with a link to /code-of-conduct in place of the body.
// Admins continue to see the original body alongside the tombstone so
// they can audit / reverse the decision.

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { CommentPhase, CommunityInput, CommunityInputConfig } from "../services/api";
import Creator from "./Creator";
import RichText from "./RichText";
import {
  adminHideComment,
  adminRestoreComment,
  getInputs,
} from "../services/api";
import { useAuth } from "../context/AuthContext";

interface Props {
  processId: string;
  config?: CommunityInputConfig;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const REASON_CHIPS = [
  "Personal attack",
  "Harassment",
  "Doxxing",
  "Spam",
  "Other",
] as const;

export default function CommunityInputPanel({ processId, config }: Props) {
  const { isAdmin } = useAuth();
  const [inputs, setInputs] = useState<CommunityInput[]>([]);
  // The hide modal is keyed off comment ID — null means "no modal open".
  const [hideModalFor, setHideModalFor] = useState<string | null>(null);
  const [hideReason, setHideReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInputs = useCallback(() => {
    getInputs(processId)
      .then(setInputs)
      .catch(() => {
        /* silent — inputs are non-critical */
      });
  }, [processId]);

  useEffect(() => {
    fetchInputs();
  }, [fetchInputs]);

  // Which phases this panel shows. Default: everything but creator updates,
  // which a page lists in its own section (projects) — so a plain comments
  // panel never has to know updates exist.
  const phases = config?.phases;
  const shown = inputs.filter((i) =>
    phases ? phases.includes((i.phase ?? "comment") as CommentPhase) : i.phase !== "update",
  );
  const heading = config?.heading ?? "Community comments";
  const noun = config?.noun ?? "comment";

  // Visible-to-residents comments include hidden ones (so the tombstone
  // takes the slot). The empty-list short-circuit must consider all of
  // them — and a page can ask for an empty state instead of nothing.
  if (shown.length === 0) {
    if (!config?.emptyText) return null;
    return (
      <div className="community-input-panel">
        <h3>{heading}</h3>
        <p className="empty-state-inline">{config.emptyText}</p>
      </div>
    );
  }

  const label =
    config?.label ??
    "Shared alongside residents' votes. Does not affect vote results.";

  async function handleHideSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hideModalFor) return;
    if (hideReason.trim().length === 0) {
      setError("Please choose or enter a reason.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const updated = await adminHideComment(hideModalFor, hideReason.trim());
      setInputs((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      );
      setHideModalFor(null);
      setHideReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not hide comment");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRestore(commentId: string) {
    setError(null);
    try {
      const updated = await adminRestoreComment(commentId);
      setInputs((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore");
    }
  }

  return (
    <div className="community-input-panel">
      <h3>{heading}</h3>
      {label && <p className="input-label">{label}</p>}

      <div className="input-list">
        <p className="input-count">
          {shown.length} {noun}{shown.length !== 1 ? "s" : ""}
        </p>
        {error && <p className="form-error">{error}</p>}
        {shown.map((input, idx) => {
          const prevPhase = idx > 0 ? shown[idx - 1].phase : null;
          const showPhaseDivider =
            input.phase === "proposal" &&
            prevPhase === "vote";
          const hidden = !!input.moderation?.hidden;
          return (
            <div key={input.id}>
            {showPhaseDivider && (
              <p className="input-phase-divider">Carried over from the proposal</p>
            )}
            <div
              className={`input-item${hidden ? " input-item-hidden" : ""}`}
            >
              {hidden ? (
                <p className="input-tombstone">
                  This comment was removed by a moderator for violating the{" "}
                  <Link to="/code-of-conduct">Code of Conduct</Link>.
                </p>
              ) : config?.richText ? (
                <RichText className="input-body" text={input.body} />
              ) : (
                <p className="input-body">{input.body}</p>
              )}

              {/* Admin-only: when hidden, show the original body next
                  to the tombstone with a "Hidden · <reason>" label and
                  a Restore button. When visible, show a "Hide" button
                  inline with the meta line. */}
              {isAdmin && hidden && (
                <div className="input-admin-shadow">
                  <p className="input-body input-body-shadow">{input.body}</p>
                  <p className="input-admin-meta">
                    <strong>Hidden</strong>
                    {input.moderation?.reason && (
                      <> · {input.moderation.reason}</>
                    )}
                    {input.moderation?.hidden_by && (
                      <> · by {input.moderation.hidden_by}</>
                    )}
                  </p>
                  <button
                    type="button"
                    className="input-admin-button"
                    onClick={() => handleRestore(input.id)}
                  >
                    Restore
                  </button>
                </div>
              )}

              <span className="input-meta">
                {/* Byline goes through <Creator> like every other surface,
                    so the Admin badge and the office pill stay identical
                    here and on proposals / projects / announcements. An
                    anonymous comment renders the bare word "Anonymous" —
                    no name, no badges: the server already nulls the
                    author fields, and passing them anyway would be one
                    edit away from piercing anonymity. */}
                {input.is_anonymous ? (
                  "Anonymous"
                ) : (
                  <Creator
                    name={input.author_name || "Resident"}
                    isAdmin={input.author_is_admin}
                    officialType={input.author_official_type}
                    officialTitle={input.author_official_title}
                  />
                )}{" "}
                {/* Moderation accountability: admins can see who posted
                    an anonymous comment; residents never can. */}
                {isAdmin && input.is_anonymous && input.author_id && (
                  <span className="input-admin-meta"> ({input.author_id})</span>
                )}
                &middot; {formatRelativeTime(input.submitted_at)}
                {isAdmin && !hidden && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="input-admin-link"
                      onClick={() => {
                        setHideModalFor(input.id);
                        setHideReason("");
                        setError(null);
                      }}
                    >
                      Hide for Code of Conduct violation
                    </button>
                  </>
                )}
              </span>
            </div>
            </div>
          );
        })}
      </div>

      {hideModalFor && (
        <div
          className="intro-overlay"
          onClick={() => !submitting && setHideModalFor(null)}
        >
          <form
            className="intro-modal moderation-modal"
            onSubmit={handleHideSubmit}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Hide this comment"
          >
            <h2 className="auth-title">Hide this comment?</h2>
            <p className="auth-description">
              The reason is stored in the moderation audit log and is
              not shown to the public. Residents see a tombstone linking
              to the Code of Conduct.
            </p>

            <div className="moderation-chips" role="list">
              {REASON_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  role="listitem"
                  className={`moderation-chip${hideReason === chip ? " is-active" : ""}`}
                  onClick={() => setHideReason(chip)}
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
                value={hideReason}
                onChange={(e) => setHideReason(e.target.value)}
                maxLength={500}
                rows={3}
                disabled={submitting}
                placeholder="Brief description of the violation"
              />
            </label>

            {error && <p className="form-error">{error}</p>}

            <div className="moderation-modal-actions">
              <button
                type="submit"
                className="auth-continue-button"
                disabled={submitting || hideReason.trim().length === 0}
              >
                {submitting ? "Hiding…" : "Hide comment"}
              </button>
              <button
                type="button"
                className="auth-back-link"
                onClick={() => setHideModalFor(null)}
                disabled={submitting}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
