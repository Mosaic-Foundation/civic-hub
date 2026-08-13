import { NavLink } from "react-router-dom";
import "./AdminTabs.css";

/**
 * Shared tab navigation for admin pages. Sits at the top of every admin
 * surface so the admin can jump between surfaces without leaving the admin
 * context. Ordered by function: the publication/approval queues first
 * (Reviews, Proposals, Vote results, Meeting summaries), then oversight
 * (Moderation, Archived), then configuration (Settings).
 *
 * Each tab is a NavLink so React Router assigns `aria-current="page"`
 * automatically on the active tab.
 */
export default function AdminTabs() {
  return (
    <>
      <div className="admin-tabs-eyebrow">Admin</div>
      <nav className="admin-tabs" aria-label="Admin sections">
      <NavLink to="/admin/reviews" className={tabClass}>
        Reviews
      </NavLink>
      <NavLink to="/admin/proposals" className={tabClass}>
        Proposals
      </NavLink>
      <NavLink to="/admin/vote-results" className={tabClass}>
        Briefs
      </NavLink>
      <NavLink to="/admin/meeting-summaries" className={tabClass}>
        Meeting summaries
      </NavLink>
      <NavLink to="/admin/moderation" className={tabClass}>
        Moderation
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
