// Reusable admin-only "Archive this item" control with a two-step confirm.
//
// Archive is a SOFT-remove distinct from CoC moderation: it hides the item
// from the public list, feed, and digest entirely (no tombstone) and is
// restorable from the admin Archived view. Use it for cleanup of stale content
// (e.g. old BoS meeting summaries), not for Code-of-Conduct enforcement.
//
// Renders nothing for non-admins. The caller passes the process id + a label
// for the confirm copy, and an optional onArchived callback (e.g. navigate away
// or refetch) run after a successful archive.

import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { adminArchiveProcess } from "../services/api";
import "./AdminArchiveButton.css";

interface Props {
  processId: string;
  /** Human label for the thing being archived, e.g. "meeting summary". */
  itemLabel: string;
  onArchived?: () => void;
}

export default function AdminArchiveButton({
  processId,
  itemLabel,
  onArchived,
}: Props) {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isAdmin) return null;

  async function handleArchive() {
    if (reason.trim().length === 0) {
      setError("Please enter a reason.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await adminArchiveProcess(processId, reason.trim());
      setOpen(false);
      setReason("");
      onArchived?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-archive-control" role="region" aria-label="Archive">
      {open ? (
        <div className="admin-archive-confirm">
          <label className="admin-archive-label">
            Archive this {itemLabel}? It will be hidden from the site and feed
            but can be restored later.
            <input
              type="text"
              className="admin-archive-reason-input"
              placeholder="Reason (for your records)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              disabled={submitting}
            />
          </label>
          <div className="admin-archive-actions">
            <button
              type="button"
              className="admin-archive-confirm-btn"
              onClick={handleArchive}
              disabled={submitting}
            >
              {submitting ? "Archiving…" : "Yes, archive"}
            </button>
            <button
              type="button"
              className="admin-archive-cancel-btn"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={submitting}
            >
              Cancel
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
        </div>
      ) : (
        <button
          type="button"
          className="admin-archive-open-btn"
          onClick={() => {
            setOpen(true);
            setReason("");
            setError(null);
          }}
        >
          Archive {itemLabel}
        </button>
      )}
    </div>
  );
}
