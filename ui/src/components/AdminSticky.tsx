/**
 * What stays in view while an admin page scrolls (Adam, 2026-11-13):
 *
 *   AdminStickyBar   a list page's filter tabs and bulk-action bar, pinned
 *                    under the hub header so a long queue can be filtered
 *                    and acted on without scrolling back up.
 *   AdminBackButton  a review page's way back to its list, a filled button
 *                    in the hub's primary (the admin rail's "Back to the hub"
 *                    shape) that floats under the hub header.
 */

import type { ReactNode } from "react";
import NavIcon from "./navIcons";
import "./AdminSticky.css";

export function AdminStickyBar({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="admin-sticky-bar" role={label ? "region" : undefined} aria-label={label}>
      {children}
    </div>
  );
}

export function AdminBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="admin-back-button" onClick={onClick}>
      <NavIcon name="back" size={18} />
      <span>{label}</span>
    </button>
  );
}
