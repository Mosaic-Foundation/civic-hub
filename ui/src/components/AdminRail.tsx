// The admin rail (pilot readiness 3, Adam 2026-11-06; dark and folding since
// Nov 7, ADR-018's amendment): admin always uses it, whatever the hub's
// public layout. At desktop width it is the left column (Sidebar.tsx); on a
// phone it opens as a drawer from the Admin button at the top of the admin
// page (AdminDrawer.tsx). The hub header stays above it.
//
// At the top, the way back to the hub and the Admin heading; then Review,
// Community and Hub settings, each folding under a chevron, with Activity a
// plain item between them (useAdminNav.ts); and at the foot, in small type,
// Archived, Setup guide and Contact Civic.Social. The group holding the page
// opens; what you open or close is remembered (useRailGroups.ts). A closed
// group's heading carries its items' counts.
//
// On Hub settings' own page at desktop width its sections are the page's
// list, drawn here through a portal (context/columnSlot.ts) so its unsaved-
// changes guard and dots come with it; anywhere else they are plain links.
//
// It may scroll on a short window; the current item is kept in view.

import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import NavItemList from "./NavItemList";
import NavIcon from "./navIcons";
import { useAdminNav, type AdminNavGroup } from "../hooks/useAdminNav";
import { useRailGroups } from "../hooks/useRailGroups";
import "./AdminRail.css";

export default function AdminRail({
  slotRef,
  onPicked,
}: {
  /** Where Hub settings' page draws its sections, in its group (desktop only). */
  slotRef?: (el: HTMLElement | null) => void;
  /** After a link is followed: the drawer closes. */
  onPicked?: () => void;
}) {
  const { entries, foot } = useAdminNav();
  const { pathname } = useLocation();
  const current = entries.find((e): e is AdminNavGroup => e.kind === "group" && e.current);
  const { isOpen, toggle } = useRailGroups(current?.id ?? null);
  const nav = useRef<HTMLElement>(null);

  // Keep the page's item in view when the rail scrolls (a short window), once
  // per page. Hub settings' sections arrive later (its page loads when first
  // needed and draws them here), so watch for the item until it is there.
  useEffect(() => {
    const root = nav.current;
    if (!root) return;
    const reveal = () => {
      const el = root.querySelector<HTMLElement>('[aria-current="page"]');
      if (!el) return false;
      el.scrollIntoView?.({ block: "nearest" });
      return true;
    };
    if (reveal() || typeof MutationObserver === "undefined") return;
    const watch = new MutationObserver(() => {
      if (reveal()) watch.disconnect();
    });
    watch.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-current"] });
    const stop = window.setTimeout(() => watch.disconnect(), 10_000);
    return () => {
      watch.disconnect();
      window.clearTimeout(stop);
    };
  }, [pathname]);

  return (
    <nav className="admin-rail" aria-label="Admin sections" ref={nav}>
      <Link to="/" className="admin-rail-back" onClick={() => onPicked?.()}>
        <NavIcon name="back" size={18} />
        <span>Back to the hub</span>
      </Link>
      <h2 className="admin-rail-title">Admin</h2>
      {entries.map((e) => {
        if (e.kind === "item") {
          return (
            <div key={e.item.id} className="admin-rail-single">
              <NavItemList className="admin-rail-list" items={[e.item]} onPicked={onPicked} label={e.item.label} />
            </div>
          );
        }
        const open = isOpen(e.id);
        const headId = `admin-rail-${e.id}`;
        const listId = `admin-rail-${e.id}-items`;
        const portal = e.id === "settings" && e.current && slotRef;
        return (
          <div key={e.id} className={`admin-rail-group${open ? " is-open" : ""}`} data-group={e.id}>
            <h3 className="admin-rail-group-head">
              <button
                type="button"
                id={headId}
                className="admin-rail-group-toggle"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => toggle(e.id)}
              >
                <span className="admin-rail-group-label">{e.label}</span>
                {!open && e.count > 0 && (
                  <span className="admin-rail-count" aria-label={`${e.count} new since you last looked`}>
                    {e.count.toLocaleString()}
                  </span>
                )}
                <NavIcon name="chevron" size={18} />
              </button>
            </h3>
            {/* Kept mounted while closed, so Hub settings' page keeps its slot. */}
            <div id={listId} className="admin-rail-group-body" hidden={!open}>
              {portal ? (
                <div className="admin-rail-subnav" ref={slotRef} />
              ) : (
                <NavItemList
                  className={`admin-rail-list${e.id === "settings" ? " admin-rail-list--sections" : ""}`}
                  items={e.items}
                  onPicked={onPicked}
                  labelledBy={headId}
                />
              )}
            </div>
          </div>
        );
      })}
      <div className="admin-rail-foot">
        <NavItemList className="admin-rail-list admin-rail-list--small" items={foot} onPicked={onPicked} label="More for admins" />
      </div>
    </nav>
  );
}
