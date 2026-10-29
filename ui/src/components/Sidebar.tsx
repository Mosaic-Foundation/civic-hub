// The left column (navigation slice, 2026-10-14; design pass, 2026-10-29): at
// desktop width, when the hub's Navigation setting is Sidebar, the hub's
// navigation and nothing else (decision 5). The hub header runs across the
// top as in the other layout and keeps the name, search, the account menu
// and Share; the column keeps the sections in the hub's order, Admin for
// admins, and the hub's own pages (Feedback, Welcome, About) at its foot.
//
// Inside admin it becomes the admin area's navigation: the way back to the
// hub, an Admin heading and the admin list (useAdminNav, the same list the
// admin bar draws in the other layout), with Hub settings' section rail
// under its item (context/columnSlot.ts).

import { Link, useLocation } from "react-router-dom";
import { useContext } from "react";
import NavItemList from "./NavItemList";
import NavIcon from "./navIcons";
import { useNavGroups, type NavItem } from "../hooks/useNavGroups";
import { isAdminPath, useAdminNav } from "../hooks/useAdminNav";
import { useNavData } from "../context/navDataState";
import { useAuth } from "../context/authState";
import { ColumnSlotContext } from "../context/columnSlot";
import "./Sidebar.css";

export default function Sidebar() {
  const { isAdmin } = useAuth();
  const { pathname } = useLocation();
  return (
    <aside className="hub-sidebar">
      {isAdmin && isAdminPath(pathname) ? <AdminColumn /> : <HubColumn />}
    </aside>
  );
}

function HubColumn() {
  // Share lives in the header's account menu; this column only navigates.
  const groups = useNavGroups({ onShare: () => {} });
  const data = useNavData();
  const hubLinks = groups.hub.filter((item) => item.to);
  const admin: NavItem[] | null = groups.admin
    ? [
        {
          id: "admin",
          label: "Admin",
          icon: "admin",
          to: data.reviewsTo,
          count: data.reviews,
          countLabel: `${data.reviews} new to review`,
        },
      ]
    : null;

  return (
    <nav className="hub-sidebar-nav" aria-label="Hub">
      <NavItemList className="hub-sidebar-list" items={groups.sections} label="Sections" />
      {admin && (
        <>
          <hr className="hub-sidebar-divider" />
          <NavItemList className="hub-sidebar-list" items={admin} label="Admin" />
        </>
      )}
      <div className="hub-sidebar-foot">
        <NavItemList className="hub-sidebar-list hub-sidebar-list--quiet" items={hubLinks} label="Hub links" />
      </div>
    </nav>
  );
}

function AdminColumn() {
  const items = useAdminNav();
  const { setSlot } = useContext(ColumnSlotContext);
  const { pathname } = useLocation();
  const inSettings = pathname.startsWith("/admin/settings");

  return (
    <nav className="hub-sidebar-nav" aria-label="Hub">
      <Link to="/" className="nav-item hub-sidebar-back">
        <NavIcon name="back" size={20} />
        <span className="nav-item-text">
          <span className="nav-item-label">Back to the hub</span>
        </span>
      </Link>
      <h2 className="hub-sidebar-heading" id="hub-sidebar-admin">
        Admin
      </h2>
      <NavItemList className="hub-sidebar-list" items={items} labelledBy="hub-sidebar-admin" />
      {/* Hub settings' sections, drawn here by the page (AdminSettings.tsx). */}
      {inSettings && <div className="hub-sidebar-subnav" ref={setSlot} />}
    </nav>
  );
}
