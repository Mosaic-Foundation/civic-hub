// The left sidebar (navigation slice, 2026-10-14): at desktop width, when the
// hub's Navigation setting is Sidebar, it replaces the header and the top
// tabs. The hub's name, search under it, the sections in the hub's order,
// then Admin for admins after a divider, the hub's links (Share this hub,
// Feedback, Welcome, About), and You with "Signed in as <name>" at the bottom
// (Adam: no top bar; Feedback is a sidebar item, not under You).

import { useState } from "react";
import { Link } from "react-router-dom";
import NavItemList from "./NavItemList";
import NavIcon from "./navIcons";
import SearchBar from "./SearchBar";
import SharePanel from "./SharePanel";
import AuthModal from "./AuthModal";
import { useNavGroups } from "../hooks/useNavGroups";
import { pluginEnabled } from "../config/plugins";
import hub from "../config/hub";
import "./Sidebar.css";

export default function Sidebar() {
  const [sharing, setSharing] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const groups = useNavGroups({ onShare: () => setSharing(true) });

  return (
    <aside className="hub-sidebar">
      <nav className="hub-sidebar-nav" aria-label="Hub">
        <Link to="/" className="hub-sidebar-brand" aria-label={`${hub.name} home`}>
          {hub.name}
        </Link>
        {pluginEnabled("search") && (
          <div className="hub-sidebar-search">
            <SearchBar inDrawer />
          </div>
        )}

        <NavItemList className="hub-sidebar-list" items={groups.sections} label="Sections" />

        {groups.admin && (
          <>
            <hr className="hub-sidebar-divider" />
            <h2 className="hub-sidebar-heading">Admin</h2>
            <NavItemList className="hub-sidebar-list" items={groups.admin} />
          </>
        )}

        <hr className="hub-sidebar-divider" />
        <NavItemList className="hub-sidebar-list" items={groups.hub} label="Hub links" />

        <div className="hub-sidebar-you">
          <hr className="hub-sidebar-divider" />
          {groups.you ? (
            <>
              <h2 className="hub-sidebar-heading hub-sidebar-signed-in">
                Signed in as <span className="hub-sidebar-name">{groups.userName}</span>
              </h2>
              <NavItemList className="hub-sidebar-list" items={groups.you} />
            </>
          ) : (
            <button type="button" className="nav-item hub-sidebar-sign-in" onClick={() => setSigningIn(true)}>
              <NavIcon name="sign-in" size={20} />
              <span className="nav-item-text">
                <span className="nav-item-label">Sign in</span>
              </span>
            </button>
          )}
        </div>
      </nav>

      {sharing && <SharePanel onClose={() => setSharing(false)} />}
      {signingIn && <AuthModal onComplete={() => setSigningIn(false)} onDismiss={() => setSigningIn(false)} />}
    </aside>
  );
}
