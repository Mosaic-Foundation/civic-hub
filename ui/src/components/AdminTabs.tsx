import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  adminQueueCounts,
  ADMIN_QUEUES_CHANGED,
  type AdminQueueCounts,
} from "../services/api";
import "./AdminTabs.css";

/**
 * Shared tab navigation for admin pages. Sits at the top of every admin
 * surface so the admin can jump between surfaces without leaving the admin
 * context. Ordered by function: the publication/approval queues first
 * (Process reviews, Briefs, Meeting summaries), then oversight
 * (Moderation, Feedback, Archived), then configuration (Settings).
 *
 * Each tab is a NavLink so React Router assigns `aria-current="page"`
 * automatically on the active tab.
 *
 * Counts (Adam, 2026-09-06): every tab shows what is NEW in its queue since
 * this admin last opened that tab — "new is defined by items that I haven't
 * viewed". Nothing stays lit for an item left in a queue on purpose; opening
 * the tab stamps its cursor and the count clears. Moderation is a log: no
 * count. Refetched on every navigation and when a page announces a change.
 */
const EMPTY: AdminQueueCounts = {
  reviews: 0,
  briefs: 0,
  meeting_summaries: 0,
  feedback: 0,
  edits: 0,
  total: 0,
};

export default function AdminTabs() {
  const location = useLocation();
  const [counts, setCounts] = useState<AdminQueueCounts>(EMPTY);
  useEffect(() => {
    let active = true;
    const refetch = () => {
      adminQueueCounts()
        .then((c) => { if (active) setCounts(c); })
        .catch(() => { /* best-effort — a failed fetch shows no badges */ });
    };
    refetch();
    window.addEventListener(ADMIN_QUEUES_CHANGED, refetch);
    return () => {
      active = false;
      window.removeEventListener(ADMIN_QUEUES_CHANGED, refetch);
    };
  }, [location.pathname]);

  const badge = (n: number, what: string) =>
    n > 0 ? (
      <span className="admin-tab-badge" aria-label={`${n} ${what}`}>
        {n}
      </span>
    ) : null;

  return (
    <>
      <div className="admin-tabs-eyebrow">Admin</div>
      <nav className="admin-tabs" aria-label="Admin sections">
      <NavLink to="/admin/reviews" className={tabClass}>
        Process reviews
        {badge(counts.reviews, "new since you last looked")}
      </NavLink>
      <NavLink to="/admin/briefs" className={tabClass}>
        Briefs
        {badge(counts.briefs, "new since you last looked")}
      </NavLink>
      <NavLink to="/admin/meeting-summaries" className={tabClass}>
        Meeting summaries
        {badge(counts.meeting_summaries, "new since you last looked")}
      </NavLink>
      <NavLink to="/admin/moderation" className={tabClass}>
        Moderation
      </NavLink>
      <NavLink to="/admin/feedback" className={tabClass}>
        Feedback
        {badge(counts.feedback, "new since you last looked")}
      </NavLink>
      <NavLink to="/admin/edits" className={tabClass}>
        Edits
        {badge(counts.edits, "new since you last looked")}
      </NavLink>
      <NavLink to="/admin/archived" className={tabClass}>
        Archived
      </NavLink>
      <NavLink to="/admin/settings" className={tabClass}>
        Settings
      </NavLink>
      </nav>
    </>
  );
}

function tabClass({ isActive }: { isActive: boolean }): string {
  return `admin-tab${isActive ? " is-active" : ""}`;
}
