// "More" on the phone's bar (navigation slice, 2026-10-14): a sheet from the
// bottom listing every section (the bar's four included) under the hub's
// name, the hub's links, then Admin for admins, then You. It is the shared
// Modal, so it traps focus, closes on Escape and a tap outside, and gives
// focus back to More on close; it also closes on a swipe down, on its × and
// (navigation polish, 2026-10-14) on More in the bar drawn under it.

import { useId, useRef, type ReactNode } from "react";
import Modal from "./Modal";
import NavItemList from "./NavItemList";
import NavIcon from "./navIcons";
import { useHub } from "../config/hub";
import type { NavGroups } from "../hooks/useNavGroups";
import "./MoreSheet.css";

/** How far a downward swipe must travel to close the sheet, in px. */
const SWIPE_CLOSE_PX = 80;

export default function MoreSheet({
  groups,
  onClose,
  onSignIn,
  bar,
}: {
  groups: NavGroups;
  onClose: () => void;
  onSignIn: () => void;
  /** The bar, drawn under the sheet, its More closing it. */
  bar: ReactNode;
}) {
  const hub = useHub();
  const swipe = useRef<{ startY: number; dy: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hubNameId = useId();

  return (
    <Modal title="More" hideTitle showClose={false} onClose={onClose} className="more-sheet" bodyClassName="more-sheet-body">
      <div
        ref={panelRef}
        className="more-sheet-panel"
        data-testid="more-sheet"
        onTouchStart={(e) => {
          // Only from the top: a swipe inside a scrolled list scrolls it.
          const top = (scrollRef.current?.scrollTop ?? 0) <= 0;
          swipe.current = top ? { startY: e.touches[0].clientY, dy: 0 } : null;
        }}
        onTouchMove={(e) => {
          const s = swipe.current;
          const p = panelRef.current;
          if (!s || !p) return;
          s.dy = Math.max(0, e.touches[0].clientY - s.startY);
          p.style.transform = s.dy > 0 ? `translateY(${s.dy}px)` : "";
        }}
        onTouchEnd={() => {
          const s = swipe.current;
          swipe.current = null;
          if (panelRef.current) panelRef.current.style.transform = "";
          if (s && s.dy > SWIPE_CLOSE_PX) onClose();
        }}
      >
        <div className="more-sheet-grab" aria-hidden="true" />
        {/* The first group is the hub itself, named as the header names it
            (Adam, 2026-10-14); the × sits on this row, under the handle. */}
        <div className="more-sheet-head">
          <h3 className="more-sheet-hubname" id={hubNameId} title={hub.name}>
            {hub.name}
          </h3>
          <button type="button" className="more-sheet-close" aria-label="Close" onClick={onClose}>
            <NavIcon name="close" size={20} />
          </button>
        </div>

        <div className="more-sheet-scroll" ref={scrollRef}>
          {/* The sections' list is named by the hub's name above it. */}
          <NavItemList className="more-sheet-list" items={groups.sections} onPicked={onClose} labelledBy={hubNameId} />
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
      </div>
      <nav className="more-sheet-bar" aria-label="Sections" data-testid="more-sheet-bar">
        {bar}
      </nav>
    </Modal>
  );
}
