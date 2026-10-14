// Admin-only Feedback archive.
//
// Everything residents sent through the feedback form, newest first,
// filterable by category. This is the operator's system of record for
// feedback — in particular for "Suggest a topic", which is how residents
// nominate subjects the Hub should take up, and which is read as a group
// when choosing what to launch with.
//
// Read-only by design: no approve, edit, or delete. An archive you can
// edit is a worse record than one you cannot. The one write is "Send to
// Civic.Social" (feedback routing, 2026-10-13), which shares an item and
// changes nothing anyone said; a shared item carries Civic.Social's status. Gated client-side via
// AuthContext.isAdmin and server-side by requireAdmin on /admin/feedback.
//
// Rows carry name/email. This page is one of only two places that PII is
// rendered (the other is the moderation-flag email), so it is deliberately
// not linked from any non-admin surface.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { adminListFeedback, adminMarkQueueSeen, notifyAdminQueuesChanged } from "../services/api";
import type { FeedbackCategory, FeedbackSubmission } from "../services/api";
import AdminTabs from "../components/AdminTabs";
import HelpButton from "../components/HelpButton";
import { ForwardButton, MosaicBadge } from "../components/ForwardToCivicSocial";
import "./AdminFeedback.css";

type Filter = FeedbackCategory | "all";

// Mirrors the pills on the public form (ui/src/pages/Feedback.tsx) in the
// same order, so the two surfaces read as one vocabulary.
const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "idea", label: "Ideas" },
  { value: "topic", label: "Topic suggestions" },
  { value: "bug", label: "Bugs" },
  { value: "moderation", label: "Moderation" },
  { value: "general", label: "General" },
];

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  idea: "Idea",
  topic: "Topic",
  bug: "Bug",
  moderation: "Moderation",
  general: "General",
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Attribution line. Signed-in submissions always have at least an email. */
function submitterLabel(item: FeedbackSubmission): string {
  if (item.name && item.email) return `${item.name} (${item.email})`;
  return item.name ?? item.email ?? "Anonymous";
}

export default function AdminFeedback() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [items, setItems] = useState<FeedbackSubmission[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Refetch per filter rather than filtering in the page: the category
  // column is indexed, and this keeps the page correct once the archive
  // outgrows a single response.
  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets this fetch's state when its input changes; one data-fetching hook replaces these (audit F6)
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminListFeedback(filter)
      .then((res) => {
        if (!cancelled) setItems(res.items);
        // Seen: everything up to now. Clears the tab's "new since you
        // looked" count; the tabs refetch on the event.
        return adminMarkQueueSeen("feedback").then(notifyAdminQueuesChanged).catch(() => {});
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
  }, [isAdmin, authLoading, filter]);

  // A digest link names a row (#fb_…). The rows render only after the fetch,
  // so scroll once they are on the page, once per address.
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (loading || !target || scrolledTo.current === target) return;
    const row = document.getElementById(target);
    if (!row) return;
    scrolledTo.current = target;
    row.scrollIntoView({ block: "center" });
  }, [loading, items]);

  if (!authLoading && !isAdmin) {
    return (
      <div className="page admin-page">
        <p>Admin access required.</p>
      </div>
    );
  }

  const activeLabel =
    FILTERS.find((f) => f.value === filter)?.label.toLowerCase() ?? "feedback";

  return (
    <div className="page admin-page">
      <AdminTabs />
      <h1>Feedback</h1>
      <p className="admin-page-description">
        Everything people have sent through the feedback form, newest
        first. Topic suggestions are people nominating subjects the Hub
        should take up: filter to them when you're deciding what to launch
        with. Bugs and ideas also went to Civic.Social, which maintains the
        software, and show its status. This archive is read-only; nothing
        here can be edited or removed.
      </p>
      <p className="admin-feedback-contact">
        <Link to="/admin/contact-civic-social">Contact Civic.Social</Link> yourself, apart from residents' feedback.
        <HelpButton k="admin.contact_civic_social" label="Contact Civic.Social" />
      </p>

      <div
        className="admin-feedback-filters"
        role="group"
        aria-label="Filter by category"
      >
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={`admin-feedback-filter${
              filter === f.value ? " is-active" : ""
            }`}
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}

      {authLoading || loading ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <p className="admin-empty">
          {filter === "all"
            ? "No feedback yet. Submissions from the feedback form show up here as they arrive."
            : `No ${activeLabel} yet.`}
        </p>
      ) : (
        <>
          <p className="admin-feedback-count">
            {items.length} {items.length === 1 ? "submission" : "submissions"}
          </p>
          <ul className="admin-feedback-list">
            {items.map((item) => (
              // id anchors the deep link from the daily admin digest.
              <li key={item.id} id={item.id} className="admin-feedback-item">
                <div className="admin-feedback-meta">
                  <span
                    className={`admin-feedback-category cat-${item.category}`}
                  >
                    {CATEGORY_LABELS[item.category] ?? item.category}
                  </span>
                  <span className="admin-feedback-when">
                    {formatTimestamp(item.created_at)}
                  </span>
                  <span className="admin-feedback-from">
                    {submitterLabel(item)}
                  </span>
                </div>
                <p className="admin-feedback-message">{item.message}</p>
                {item.page_path && <p className="admin-feedback-page">Page: {item.page_path}</p>}
                <div className="admin-feedback-share" id={`${item.id}-share`}>
                  {item.mosaic ? (
                    <MosaicBadge copy={item.mosaic} />
                  ) : (
                    <>
                      <ForwardButton
                        item={item}
                        onForwarded={(next) => setItems((all) => all.map((i) => (i.id === next.id ? next : i)))}
                      />
                      <HelpButton k="admin.feedback_forward" label="Send to Civic.Social" />
                    </>
                  )}
                </div>
                {item.screenshot_url && (
                  <a
                    className="admin-feedback-screenshot"
                    href={item.screenshot_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open the screenshot full size"
                  >
                    <img src={item.screenshot_url} alt="Screenshot attached to this report" loading="lazy" />
                    <span>Screenshot</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
