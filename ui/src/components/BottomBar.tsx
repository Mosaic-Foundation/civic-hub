// The phone's bar (navigation slice, 2026-10-14): fixed to the bottom of the
// screen at phone width, under either Navigation setting. Five tabs: the
// first four sections in the hub's Section order (Feed first), each an icon
// and its short label (the registry's, else its name), then More, which
// opens the sheet with everything else. The current tab is marked with
// aria-current="page" and drawn with a shape and weight as well as colour.
// Drafting forms hide it (DraftingForm.css), so the form keeps its focused
// screen and its own Submit bar.
//
// More closes where it opened (navigation polish, 2026-10-14): the sheet is
// the shared Modal, which makes the page behind it inert, so the sheet draws
// the same bar under itself (BarTabs, inSheet) with More current, its icon a
// ×, closing the sheet.

import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import NavIcon from "./navIcons";
import MoreSheet from "./MoreSheet";
import SharePanel from "./SharePanel";
import AuthModal from "./AuthModal";
import { useNavGroups, type NavGroups } from "../hooks/useNavGroups";
import { useNavData } from "../context/NavDataContext";
import { BAR_SECTION_COUNT } from "../../../src/shared/navSections";
import "./BottomBar.css";

export default function BottomBar() {
  const [moreOpen, setMoreOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const groups = useNavGroups({ onShare: () => setSharing(true) });
  const moreRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <nav className="bottom-bar" aria-label="Sections">
        <BarTabs groups={groups} moreOpen={false} onMore={() => setMoreOpen(true)} moreRef={moreRef} />
      </nav>

      {moreOpen && (
        <MoreSheet
          groups={groups}
          onClose={() => setMoreOpen(false)}
          onSignIn={() => setSigningIn(true)}
          bar={<BarTabs groups={groups} moreOpen onMore={() => setMoreOpen(false)} onPicked={() => setMoreOpen(false)} />}
        />
      )}
      {sharing && <SharePanel onClose={() => setSharing(false)} />}
      {signingIn && <AuthModal onComplete={() => setSigningIn(false)} onDismiss={() => setSigningIn(false)} />}
    </>
  );
}

/**
 * The bar's five tabs. Under the sheet (`moreOpen`), More is the current tab,
 * shows a × and closes it; a section tab closes it and goes there.
 */
export function BarTabs({
  groups,
  moreOpen,
  onMore,
  onPicked,
  moreRef,
}: {
  groups: NavGroups;
  moreOpen: boolean;
  onMore: () => void;
  onPicked?: () => void;
  moreRef?: React.Ref<HTMLButtonElement>;
}) {
  const data = useNavData();
  const tabs = groups.sections.slice(0, BAR_SECTION_COUNT);
  // More is the current tab when the sheet is open, or the page is one only
  // the sheet lists.
  const elsewhere = [...groups.sections.slice(BAR_SECTION_COUNT), ...groups.hub, ...(groups.admin ?? []), ...(groups.you ?? [])];
  const moreCurrent = moreOpen || (!tabs.some((t) => t.current) && elsewhere.some((i) => i.current));
  // Something in the sheet needs you: reviews for an admin, your own submissions.
  const attention = data.reviews + data.mySubmissions + data.editNotifs.length;
  const moreLabel = moreOpen
    ? "Close More"
    : attention > 0
      ? `More, ${attention} need${attention === 1 ? "s" : ""} your attention`
      : "More";

  return (
    <ul className="bottom-bar-tabs">
      {tabs.map((t) => (
        <li key={t.id}>
          <Link
            to={t.to ?? "/"}
            className={`bottom-bar-tab${t.current && !moreOpen ? " is-current" : ""}`}
            aria-current={t.current && !moreOpen ? "page" : undefined}
            data-nav-id={t.id}
            onClick={() => onPicked?.()}
          >
            <NavIcon name={t.icon} />
            <span className="bottom-bar-label">{t.short ?? t.label}</span>
          </Link>
        </li>
      ))}
      <li>
        <button
          ref={moreRef}
          type="button"
          className={`bottom-bar-tab${moreCurrent ? " is-current" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-label={moreLabel}
          onClick={onMore}
          data-nav-id="more"
        >
          <span className="bottom-bar-icon">
            <NavIcon name={moreOpen ? "close" : "more"} />
            {!moreOpen && attention > 0 && <span className="bottom-bar-dot" aria-hidden="true" />}
          </span>
          <span className="bottom-bar-label">More</span>
        </button>
      </li>
    </ul>
  );
}
