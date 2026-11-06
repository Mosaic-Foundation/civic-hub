// The admin rail (pilot readiness 3, Adam 2026-11-06): admin always uses it,
// whatever the hub's public layout. At desktop width it is the left column
// (Sidebar.tsx); on a phone it opens as a drawer from the Admin button at the
// top of the admin page (AdminDrawer.tsx). The hub header stays above it.
//
// At the top, the way back to the hub and the Admin heading; then the groups
// (useAdminNav.ts); Hub settings' sections open under it only while you're in
// it, drawn there by the page through a portal (context/columnSlot.ts); and at
// the foot, in small type, Archived, Setup guide and Contact Civic.Social.
//
// It never scrolls: tests/e2e/adminRail.spec.ts checks it fits 768px tall
// with every plugin on and Hub settings open.

import { Link } from "react-router-dom";
import NavItemList from "./NavItemList";
import NavIcon from "./navIcons";
import { useAdminNav } from "../hooks/useAdminNav";
import "./AdminRail.css";

export default function AdminRail({
  slotRef,
  onPicked,
}: {
  /** Where Hub settings draws its sections, under its item (desktop only). */
  slotRef?: (el: HTMLElement | null) => void;
  /** After a link is followed: the drawer closes. */
  onPicked?: () => void;
}) {
  const { groups, foot } = useAdminNav();
  return (
    <nav className="admin-rail" aria-label="Admin sections">
      <Link to="/" className="admin-rail-back" onClick={() => onPicked?.()}>
        <NavIcon name="back" size={16} />
        <span>Back to the hub</span>
      </Link>
      <h2 className="admin-rail-title">Admin</h2>
      {groups.map((g) => {
        const headId = `admin-rail-${g.id}`;
        const settingsOpen = g.items.some((i) => i.id === "hub-settings" && i.current);
        return (
          <div key={g.id} className="admin-rail-group" data-group={g.id}>
            {g.label && (
              <h3 className="admin-rail-group-head" id={headId}>
                <span>{g.label}</span>
                {g.count > 0 && (
                  <span className="admin-rail-group-count" aria-label={`${g.count} new since you last looked`}>
                    {g.count.toLocaleString()}
                  </span>
                )}
              </h3>
            )}
            <NavItemList
              className="admin-rail-list"
              items={g.items}
              onPicked={onPicked}
              {...(g.label ? { labelledBy: headId } : { label: "Admin" })}
            />
            {settingsOpen && slotRef && <div className="admin-rail-subnav" ref={slotRef} />}
          </div>
        );
      })}
      <div className="admin-rail-foot">
        <NavItemList className="admin-rail-list admin-rail-list--small" items={foot} onPicked={onPicked} label="More for admins" />
      </div>
    </nav>
  );
}
