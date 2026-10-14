// "More" on the phone's bar (navigation slice, 2026-10-14): a sheet from the
// bottom listing every section (the bar's four included), the hub's links,
// then Admin for admins, then You. It is the shared Modal, so it traps focus,
// closes on Escape and a tap outside, and gives focus back to More on close;
// it also closes on a swipe down.

import { useRef } from "react";
import Modal from "./Modal";
import NavItemList from "./NavItemList";
import NavIcon from "./navIcons";
import type { NavGroups } from "../hooks/useNavGroups";
import "./MoreSheet.css";

/** How far a downward swipe must travel to close the sheet, in px. */
const SWIPE_CLOSE_PX = 80;

export default function MoreSheet({
  groups,
  onClose,
  onSignIn,
}: {
  groups: NavGroups;
  onClose: () => void;
  onSignIn: () => void;
}) {
  const swipe = useRef<{ startY: number; dy: number } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // The scroll container is the Modal's panel; the swipe moves it.
  const panel = () => contentRef.current?.closest<HTMLElement>(".modal-body") ?? null;

  return (
    <Modal title="More" hideTitle onClose={onClose} className="more-sheet" bodyClassName="more-sheet-body">
      <div
        ref={contentRef}
        data-testid="more-sheet"
        onTouchStart={(e) => {
          const p = panel();
          // Only from the top: a swipe inside a scrolled list scrolls it.
          swipe.current = p && p.scrollTop <= 0 ? { startY: e.touches[0].clientY, dy: 0 } : null;
        }}
        onTouchMove={(e) => {
          const s = swipe.current;
          const p = panel();
          if (!s || !p) return;
          s.dy = Math.max(0, e.touches[0].clientY - s.startY);
          p.style.transform = s.dy > 0 ? `translateY(${s.dy}px)` : "";
        }}
        onTouchEnd={() => {
          const s = swipe.current;
          const p = panel();
          swipe.current = null;
          if (p) p.style.transform = "";
          if (s && s.dy > SWIPE_CLOSE_PX) onClose();
        }}
      >
        <div className="more-sheet-grab" aria-hidden="true" />

        <h3 className="more-sheet-heading">Hub</h3>
        <NavItemList className="more-sheet-list" items={groups.sections} onPicked={onClose} />
        <NavItemList className="more-sheet-list more-sheet-list--links" items={groups.hub} onPicked={onClose} label="Hub links" />

        {groups.admin && (
          <>
            <h3 className="more-sheet-heading">Admin</h3>
            <NavItemList className="more-sheet-list" items={groups.admin} onPicked={onClose} />
          </>
        )}

        <h3 className="more-sheet-heading">You</h3>
        {groups.you ? (
          <>
            <p className="more-sheet-signed-in">Signed in as {groups.userName}</p>
            <NavItemList className="more-sheet-list" items={groups.you} onPicked={onClose} />
          </>
        ) : (
          <ul className="more-sheet-list">
            <li>
              <button
                type="button"
                className="nav-item"
                onClick={() => {
                  onClose();
                  onSignIn();
                }}
              >
                <NavIcon name="sign-in" size={20} />
                <span className="nav-item-text">
                  <span className="nav-item-label">Sign in</span>
                </span>
              </button>
            </li>
          </ul>
        )}
      </div>
    </Modal>
  );
}
