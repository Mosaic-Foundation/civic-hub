// Slice 11 — admin-only moderation log.
//
// Read-only list of every moderation action taken on the Hub
// (comments hidden / restored, announcements removed / restored).
// Sourced from civic.process.updated events that carry
// `data.moderation` and `meta.visibility = "restricted"`. The /events
// endpoint filters those out for non-admin callers; this page is
// gated client-side via AuthContext.isAdmin and server-side by the
// same check on /admin/moderation/log.
//
// MVP scope: newest first, no filters, no pagination. We don't expect
// enough volume to need either at launch; both can be layered on
// later from the same data source.

import { useApi } from "../hooks/useApi";
import { Link } from "react-router-dom";
import { useAuth } from "../context/authState";
import {
  adminGetModerationLog,
  type ModerationLogEntry,
} from "../services/api";
import { localTimestamp } from "../utils/dates";

function actionLabel(action: string): string {
  switch (action) {
    case "comment_hidden":
      return "Comment hidden";
    case "comment_restored":
      return "Comment restored";
    case "announcement_removed":
      return "Announcement removed";
    case "announcement_restored":
      return "Announcement restored";
    case "process_archived":
      return "Item archived";
    case "process_restored":
      return "Item restored";
    default:
      return action;
  }
}

export default function AdminModeration() {
  const { isAdmin, loading: authLoading } = useAuth();
  const { data, loading, error } = useApi(!authLoading && isAdmin ? "admin/moderation-log" : null, () =>
    adminGetModerationLog(),
  );
  const entries: ModerationLogEntry[] = data?.entries ?? [];

  if (authLoading || loading) {
    return (
      <div className="page admin-page">
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

  if (error) {
    return (
      <div className="page admin-page">
        <p className="form-error">Could not load the log: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="page admin-page">
      <h1 className="kit-page-title">Moderation log</h1>
      <p className="admin-page-description kit-page-lede">
        Every moderation action — comment hides, announcement removals,
        and their restorations — is recorded here. Newest first. The
        underlying events live on the audit trail with
        <code> meta.visibility = "restricted"</code>, so they never
        appear in the public event feed or in the daily digest.
      </p>

      {entries.length === 0 ? (
        <p className="admin-empty">
          No moderation actions yet. When you hide a comment or remove
          an announcement, the action shows up here.
        </p>
      ) : (
        <div className="kit-table-wrap">
        <table className="admin-moderation-table kit-table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Action</th>
              <th scope="col">Target</th>
              <th scope="col">Reason</th>
              <th scope="col">Admin</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.event_id}>
                <td>{localTimestamp(entry.timestamp)}</td>
                <td>{actionLabel(entry.action)}</td>
                <td>
                  {entry.target_kind === "announcement" ? (
                    <Link to={`/announcement/${entry.process_id}`}>
                      {entry.process_title ?? entry.process_id}
                    </Link>
                  ) : entry.target_kind === "comment" ? (
                    <Link to={`/process/${entry.process_id}`}>
                      {entry.process_title ?? entry.process_id}
                    </Link>
                  ) : (
                    entry.process_id
                  )}
                </td>
                <td className="admin-moderation-reason">
                  {entry.reason ?? "—"}
                </td>
                <td>{entry.admin}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
