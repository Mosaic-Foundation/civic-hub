import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { adminListEdits } from "../services/api";
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
 */
export default function AdminTabs() {
  // Edits badge: how many edited processes are new since the admin last
  // opened the Edits tab. Best-effort; a failed fetch shows no badge.
  const [unseenEdits, setUnseenEdits] = useState(0);
  useEffect(() => {
    let active = true;
    adminListEdits()
      .then((r) => { if (active) setUnseenEdits(r.unseen); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  return (
    <>
      <div className="admin-tabs-eyebrow">Admin</div>
      <nav className="admin-tabs" aria-label="Admin sections">
      <NavLink to="/admin/reviews" className={tabClass}>
        Process reviews
      </NavLink>
      <NavLink to="/admin/briefs" className={tabClass}>
        Briefs
      </NavLink>
      <NavLink to="/admin/meeting-summaries" className={tabClass}>
        Meeting summaries
      </NavLink>
      <NavLink to="/admin/moderation" className={tabClass}>
        Moderation
      </NavLink>
      <NavLink to="/admin/feedback" className={tabClass}>
        Feedback
      </NavLink>
      <NavLink to="/admin/edits" className={tabClass}>
        Edits
        {unseenEdits > 0 && <span className="admin-tab-badge">{unseenEdits}</span>}
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
