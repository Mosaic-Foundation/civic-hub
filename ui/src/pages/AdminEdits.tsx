import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { adminListEdits, markEditsSeen, type AdminEditRow } from "../services/api";
import AdminTabs from "../components/AdminTabs";
import "./AdminEdits.css";

/**
 * Admin panel → Edits: every live process a creator has edited (any type —
 * only projects can be edited today), newest first. No approval here —
 * edits go live at once and pass the Code of Conduct check on the way;
 * this is the admin's overview, and opening it clears the tab's badge
 * (Adam, 2026-09-03: "a flag in the admin panel… a new tab that says
 * edits", not the account dropdown).
 */

const FIELD_LABELS: Record<string, string> = {
  title: "title",
  description: "description",
  sources: "sources",
  banner_image_url: "banner image",
  banner_image_alt: "banner image description",
  links: "related processes",
};

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function AdminEdits() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [items, setItems] = useState<AdminEditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) { setLoading(false); return; }
    let cancelled = false;
    adminListEdits()
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        // Seen: the tab has been opened. The rows keep their "new" mark for
        // this render so the admin can see what was new.
        if (res.unseen > 0) markEditsSeen().catch(() => {});
      })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isAdmin, authLoading]);

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
      <h1>Edits</h1>
      <p className="admin-edits-intro">
        Changes creators have made to live processes in the last 90 days. Edits go live at once
        after the Code of Conduct check; every version stays on the page under "See what changed".
        Nothing here needs approval.
      </p>

      {error && <p className="form-error">{error}</p>}

      {items.length === 0 ? (
        <p className="admin-edits-empty">Nothing has been edited yet.</p>
      ) : (
        <table className="admin-edits-table">
          <thead>
            <tr>
              <th>Process</th>
              <th>Type</th>
              <th>Edits</th>
              <th>Changed</th>
              <th>Latest</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.process_id} className={row.unseen ? "is-new" : undefined}>
                <td>
                  {row.unseen && <span className="admin-edits-new">New</span>}
                  <Link to={row.href}>{row.title}</Link>
                  {row.status === "archived" && <span className="admin-edits-status"> · archived</span>}
                </td>
                <td>{row.type_label}</td>
                <td>{row.edits}</td>
                <td>{row.changed_fields.map((f) => FIELD_LABELS[f] ?? f.replace(/_/g, " ")).join(", ")}</td>
                <td><time dateTime={row.latest_at}>{when(row.latest_at)}</time></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
