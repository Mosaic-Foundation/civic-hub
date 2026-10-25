import { Link, useNavigate } from "react-router-dom";
import { useNavData } from "../context/navDataState";
import { useDropdownMenu } from "../hooks/useDropdownMenu";
import "./AdminMenu.css";

/**
 * The admin's way into everything (admin menu slice, 2026-10-13): a review
 * icon with a count, and the Admin pill, whose dropdown has five items, the
 * last one Contact Civic.Social (feedback routing, 2026-10-13). The account menu beside it holds only personal things.
 *
 * The review count is what is NEW since this admin last opened each review
 * queue (processes, briefs, meeting summaries), the same numbers the admin
 * tabs show. Feedback and edits keep their counts on their own tabs.
 * Moderation is a log of what admins did, so it has no count (Adam,
 * 2026-10-13).
 *
 * At phone width the More sheet's Admin group replaces this menu, and in the
 * sidebar layout the sidebar does (navigation slice, 2026-10-14).
 */

export default function AdminMenu() {
  const navigate = useNavigate();
  const { open, setOpen, buttonRef, menuRef, onMenuKey, choose } = useDropdownMenu();
  // The counts are read once for the whole navigation (context/NavDataContext.tsx).
  // The icon opens the first queue with something new, so the click clears
  // what the number counted; with nothing new it opens Processes.
  const { reviews, reviewsTo } = useNavData();
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
            <MenuItem label="Hub settings" onClick={() => choose(() => navigate("/admin/settings"))} />
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
