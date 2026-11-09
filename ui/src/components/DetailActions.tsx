import type { ReactNode } from "react";
import { SlotArchiveButton } from "./archiveSlot";
import { useClaimArchiveSlot } from "./archiveSlotContext";
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
 *
 * Archive is the framework's (archiveSlot.tsx, 2026-11-09): on a type's
 * detail route this row ends with the archive control, so a page never adds
 * its own. `host` is the row the framework draws after a page with none.
 */
function Row({ children }: { children?: ReactNode }) {
  return (
    <div className="detail-actions" role="group" aria-label="Manage this item">
      {children}
    </div>
  );
}

function PageRow({ children }: { children?: ReactNode }) {
  const inSlot = useClaimArchiveSlot();
  return (
    <Row>
      {children}
      {inSlot && <SlotArchiveButton />}
    </Row>
  );
}

export default function DetailActions({ children, host }: { children?: ReactNode; host?: true }) {
  // The framework's row sits after the page, so it takes a detail page's side
  // padding to line up with the page's content.
  return host ? (
    <div className="detail-page detail-actions-host">
      <Row>{children}</Row>
    </div>
  ) : (
    <PageRow>{children}</PageRow>
  );
}
