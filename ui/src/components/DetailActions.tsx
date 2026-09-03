import type { ReactNode } from "react";
import "./DetailActions.css";

/**
 * The one place on a detail page for terminal / administrative actions —
 * "Mark complete", "Archive" — deliberately the LAST thing before the
 * footer, below the record and its Related panel, so nobody reaches one
 * by accident while reading (Adam: the project's Mark complete sat at the
 * top; "anybody wanting to complete or archive it has to go to the
 * bottom").
 *
 * UNIVERSAL: every detail page mounts it once and drops its actions in.
 * The children decide for themselves whether the viewer may see them
 * (AdminArchiveButton renders null for non-admins), and the block hides
 * itself when nothing rendered (CSS :empty), so a resident sees no stray
 * rule. A type added later puts its own end-of-life action here and gets
 * the same placement.
 */
export default function DetailActions({ children }: { children: ReactNode }) {
  return (
    <div className="detail-actions" role="group" aria-label="Manage this item">
      {children}
    </div>
  );
}
