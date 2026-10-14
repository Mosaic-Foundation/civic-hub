// The phone's bar (navigation slice, 2026-10-14): fixed to the bottom of the
// screen at phone width, under either Navigation setting. Five tabs: the
// first four sections in the hub's Section order (Feed first), each an icon
// and one word, then More, which opens the sheet with everything else. The
// current tab is marked with aria-current="page" and drawn with a shape and
// weight as well as colour. Drafting forms hide it (DraftingForm.css), so
// the form keeps its focused screen and its own Submit bar.

import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import NavIcon from "./navIcons";
import MoreSheet from "./MoreSheet";
import SharePanel from "./SharePanel";
import AuthModal from "./AuthModal";
import { useNavGroups } from "../hooks/useNavGroups";
import { useNavData } from "../context/NavDataContext";
import { BAR_SECTION_COUNT } from "../../../src/shared/navSections";
import "./BottomBar.css";

export default function BottomBar() {
  const [moreOpen, setMoreOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const groups = useNavGroups({ onShare: () => setSharing(true) });
  const data = useNavData();
  const moreRef = useRef<HTMLButtonElement>(null);

  const tabs = groups.sections.slice(0, BAR_SECTION_COUNT);
  // More is the current tab when the page is one only the sheet lists.
  const elsewhere = [...groups.sections.slice(BAR_SECTION_COUNT), ...groups.hub, ...(groups.admin ?? []), ...(groups.you ?? [])];
  const moreCurrent = !tabs.some((t) => t.current) && elsewhere.some((i) => i.current);
  // Something in the sheet needs you: reviews for an admin, your own submissions.
  const attention = data.reviews + data.mySubmissions + data.editNotifs.length;

  return (
    <>
      <nav className="bottom-bar" aria-label="Sections">
        <ul className="bottom-bar-tabs">
          {tabs.map((t) => (
            <li key={t.id}>
              <Link
                to={t.to ?? "/"}
                className={`bottom-bar-tab${t.current ? " is-current" : ""}`}
                aria-current={t.current ? "page" : undefined}
                data-nav-id={t.id}
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
              aria-label={attention > 0 ? `More, ${attention} need${attention === 1 ? "s" : ""} your attention` : "More"}
              onClick={() => setMoreOpen(true)}
              data-nav-id="more"
            >
              <span className="bottom-bar-icon">
                <NavIcon name="more" />
                {attention > 0 && <span className="bottom-bar-dot" aria-hidden="true" />}
              </span>
              <span className="bottom-bar-label">More</span>
            </button>
          </li>
        </ul>
      </nav>

      {moreOpen && (
        <MoreSheet groups={groups} onClose={() => setMoreOpen(false)} onSignIn={() => setSigningIn(true)} />
      )}
      {sharing && <SharePanel onClose={() => setSharing(false)} />}
      {signingIn && <AuthModal onComplete={() => setSigningIn(false)} onDismiss={() => setSigningIn(false)} />}
    </>
  );
}
