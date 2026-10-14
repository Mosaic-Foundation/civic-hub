import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { adminQueueCounts, ADMIN_QUEUES_CHANGED, type AdminQueueCounts } from "../services/api";
import { useDropdownMenu } from "../hooks/useDropdownMenu";
import "./AdminMenu.css";

/**
 * The admin's way into everything (admin menu slice, 2026-10-13): a review
 * icon with a count, and the Admin pill, whose dropdown has five items, the
 * last one Contact Civic.Social (feedback routing, 2026-10-15). The account menu beside it holds only personal things.
 *
 * The review count is what is NEW since this admin last opened each review
 * queue (processes, briefs, meeting summaries), the same numbers the admin
 * tabs show. Feedback and edits keep their counts on their own tabs.
 * Moderation is a log of what admins did, so it has no count (Adam,
 * 2026-10-13).
 */

const REVIEW_QUEUES = [
  { key: "reviews", to: "/admin/reviews" },
  { key: "briefs", to: "/admin/briefs" },
  { key: "meeting_summaries", to: "/admin/meeting-summaries" },
] as const;

export default function AdminMenu() {
  const location = useLocation();
  const navigate = useNavigate();
  const { open, setOpen, buttonRef, menuRef, onMenuKey, choose } = useDropdownMenu();
  const [counts, setCounts] = useState<AdminQueueCounts | null>(null);

  useEffect(() => {
    let active = true;
    const refetch = () => {
      adminQueueCounts()
        .then((c) => { if (active) setCounts(c); })
        .catch(() => { /* best-effort: a failed poll shows no count */ });
    };
    refetch();
    const interval = setInterval(refetch, 60_000);
    window.addEventListener(ADMIN_QUEUES_CHANGED, refetch);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener(ADMIN_QUEUES_CHANGED, refetch);
    };
  }, [location.pathname]);

  const reviews = counts ? REVIEW_QUEUES.reduce((n, q) => n + counts[q.key], 0) : 0;
  // The icon opens the first queue with something new, so the click clears
  // what the number counted; with nothing new it opens Processes.
  const reviewsTo = REVIEW_QUEUES.find((q) => (counts?.[q.key] ?? 0) > 0)?.to ?? "/admin/reviews";
  const reviewsLabel = reviews > 0 ? `Reviews: ${reviews} new` : "Reviews: nothing new";

  return (
    <>
      <Link to={reviewsTo} className="admin-review-icon" aria-label={reviewsLabel} title={reviewsLabel} data-testid="admin-review-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 13l2.5-8h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M3 13h5l1.5 2.5h5L16 13h5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
        {reviews > 0 && <span className="admin-count admin-count--icon" aria-hidden="true">{reviews}</span>}
      </Link>

      <div className="admin-menu-wrap">
        <button
          ref={buttonRef}
          type="button"
          className={`admin-pill${open ? " is-open" : ""}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls="admin-menu"
          onClick={() => setOpen((v) => !v)}
        >
          Admin
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          </svg>
        </button>
        {open && (
          <div
            ref={menuRef}
            id="admin-menu"
            className="civic-nav-menu admin-menu"
            role="menu"
            aria-label="Admin"
            onKeyDown={onMenuKey}
          >
            <MenuItem label="Reviews" count={reviews} onClick={() => choose(() => navigate(reviewsTo))} />
            <MenuItem label="Moderation" onClick={() => choose(() => navigate("/admin/moderation"))} />
            <MenuItem label="Settings" onClick={() => choose(() => navigate("/admin/settings"))} />
            <MenuItem label="Plugins" onClick={() => choose(() => navigate("/admin/settings/plugins"))} />
            <MenuItem label="Contact Civic.Social" onClick={() => choose(() => navigate("/admin/contact-civic-social"))} />
          </div>
        )}
      </div>
    </>
  );
}

function MenuItem({ label, count, onClick }: { label: string; count?: number; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" className="civic-nav-menu-item" onClick={onClick}>
      {label}
      {count !== undefined && count > 0 && (
        <span className="civic-nav-menu-badge" aria-label={`${count} new`}>{count}</span>
      )}
    </button>
  );
}
