// Admin-only Archived view.
//
// Lists every soft-archived process (meeting summaries, announcements, votes,
// proposals, projects, conversations) with who archived it, when, and why —
// and a two-step Restore control that puts the item back in its prior status.
// Archiving is a soft-remove: nothing is hard-deleted, so everything here is
// recoverable. Gated client-side via AuthContext.isAdmin and server-side by
// requireAdmin on /admin/archived.

import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { adminListArchived, adminRestoreProcess } from "../services/api";
import type { ArchivedProcess } from "../services/api";
import AdminTabs from "../components/AdminTabs";
import "./AdminArchived.css";

const TYPE_LABELS: Record<string, string> = {
  "civic.vote": "Vote",
  "civic.proposal": "Proposal",
  "civic.polis_deliberation": "Conversation",
  "civic.project": "Project",
  "civic.meeting_summary": "Meeting summary",
  "civic.announcement": "Announcement",
  "civic.wordcloud": "Word cloud",
  "civic.vote_results": "Vote results",
};

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AdminArchived() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [items, setItems] = useState<ArchivedProcess[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The id currently in the "confirm restore" state (two-step), and any id
  // whose restore request is in flight.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    adminListArchived()
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, authLoading]);

  async function handleRestore(id: string) {
    setRestoringId(id);
    setNotice(null);
    try {
      await adminRestoreProcess(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
      setNotice("Item restored. It is live again in its previous state.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setRestoringId(null);
      setConfirmId(null);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="page admin-page">
        <AdminTabs />
        <p>Loading…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="page admin-page">
        <p>Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="page admin-page">
      <AdminTabs />
      <h1>Archived</h1>
      <p className="admin-page-description">
        Items you've archived — meeting summaries, announcements, and other
        processes. Archived items are hidden from the public list, the feed,
        and the daily digest, but nothing is permanently deleted. Restore an
        item to put it back exactly where it was.
      </p>

      {error && <p className="form-error">{error}</p>}
      {notice && <p className="admin-archived-notice">{notice}</p>}

      {items.length === 0 ? (
        <p className="admin-empty">
          Nothing is archived. When you archive a meeting summary,
          announcement, or other item, it shows up here so you can restore it
          later.
        </p>
      ) : (
        <table className="admin-archived-table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Type</th>
              <th scope="col">Archived</th>
              <th scope="col">Reason</th>
              <th scope="col" className="admin-archived-actions-col">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.title}</td>
                <td>{typeLabel(item.type)}</td>
                <td>{formatTimestamp(item.archived_at)}</td>
                <td className="admin-archived-reason">{item.reason ?? "—"}</td>
                <td className="admin-archived-actions">
                  {confirmId === item.id ? (
                    <span className="admin-archived-confirm">
                      <span className="admin-archived-confirm-label">
                        Restore?
                      </span>
                      <button
                        type="button"
                        className="admin-archived-restore-confirm"
                        onClick={() => handleRestore(item.id)}
                        disabled={restoringId === item.id}
                      >
                        {restoringId === item.id ? "Restoring…" : "Yes, restore"}
                      </button>
                      <button
                        type="button"
                        className="admin-archived-cancel"
                        onClick={() => setConfirmId(null)}
                        disabled={restoringId === item.id}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="admin-archived-restore-btn"
                      onClick={() => setConfirmId(item.id)}
                    >
                      Restore
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
