/**
 * What stays in view while an admin page scrolls (Adam, 2026-11-13):
 *
 *   AdminStickyBar   a list page's filter tabs and bulk-action bar, pinned
 *                    under the hub header so a long queue can be filtered
 *                    and acted on without scrolling back up.
 *   AdminBackButton  a review page's way back to its list, a filled button
 *                    in the hub's primary (the admin rail's "Back to the hub"
 *                    shape) that floats under the hub header. Also on My
                    submissions, a resident's review page (Adam, 2026-11-14).
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

export function AdminBackButton({
  label,
  onClick,
  underTabs = false,
}: {
  label: string;
  onClick: () => void;
  /** On a resident page: floats under the section tabs too (--tabs-h, 0 where they're hidden). */
  underTabs?: boolean;
}) {
  return (
    <button type="button" className={`admin-back-button${underTabs ? " admin-back-button--under-tabs" : ""}`} onClick={onClick}>
      <NavIcon name="back" size={18} />
      <span>{label}</span>
    </button>
  );
}
