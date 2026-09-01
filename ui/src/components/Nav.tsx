import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getReviewNotificationCount } from "../services/api";
import AuthModal from "./AuthModal";
import SearchBar from "./SearchBar";
import hub from "../config/hub";
import { BETA_PUBLIC_PATHS } from "../config/betaPublicPaths";
import "./Nav.css";

// Top nav stays minimal: wordmark + search + sign-in. All primary
// navigation lives in the always-visible hamburger drawer below.
const TOP_LINKS: ReadonlyArray<{ to: string; label: string; end?: boolean }> = [];

// Primary drawer links. Legal docs are grouped after a divider so the
// civic surfaces stay visually distinct from the policy footer pages.
const DRAWER_LINKS: ReadonlyArray<{ to: string; label: string; end?: boolean }> = [
  { to: "/", label: "Feed", end: true },
  { to: "/deliberations", label: "Conversations" },
  { to: "/propose", label: "Propose" },
  { to: "/votes", label: "Votes" },
  { to: "/projects", label: "Projects" },
  { to: "/outcomes", label: "Outcomes" },
  { to: "/welcome", label: "Welcome" },
  { to: "/about", label: "About" },
];

// Secondary drawer link — active-input affordance; styled like the
// primary links (full-weight, regular size), not the muted legal
// group below it. Slice 14.
const DRAWER_SECONDARY_LINKS: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/feedback", label: "Send feedback" },
];

const DRAWER_LEGAL_LINKS: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/code-of-conduct", label: "Code of Conduct" },
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
];

// Six muted, accessible-on-white background colors for the avatar circle.
// Foreground (initial letter) is always white; backgrounds are saturated
// enough to give white text >= 4.5:1 contrast.
const AVATAR_COLORS = [
  "#1e3a5f", // brand navy
  "#0f5a55", // teal
  "#8c3210", // terracotta
  "#0f4a26", // forest
  "#5b21b6", // violet
  "#a16207", // ochre
] as const;

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export default function Nav() {
  const { user, logout, isAdmin, canPostAnnouncements } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [notifCount, setNotifCount] = useState(0);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  // Close menu / drawer on click-outside or Escape.
  useEffect(() => {
    if (!menuOpen && !drawerOpen) return;
    function handlePointer(e: MouseEvent) {
      const target = e.target as Node;
      if (menuOpen) {
        if (
          !menuRef.current?.contains(target) &&
          !avatarRef.current?.contains(target)
        ) {
          setMenuOpen(false);
        }
      }
      if (drawerOpen) {
        if (
          !drawerRef.current?.contains(target) &&
          !hamburgerRef.current?.contains(target)
        ) {
          setDrawerOpen(false);
        }
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (menuOpen) {
          setMenuOpen(false);
          avatarRef.current?.focus();
        }
        if (drawerOpen) {
          setDrawerOpen(false);
          hamburgerRef.current?.focus();
        }
      }
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen, drawerOpen]);

  // Arrow-key navigation inside the menu.
  function handleMenuKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = items[(currentIndex + 1 + items.length) % items.length];
      next?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = items[(currentIndex - 1 + items.length) % items.length];
      prev?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      setMenuOpen(false);
    }
  }

  function selectMenuItem(action: () => void) {
    setMenuOpen(false);
    action();
  }

  function handleLogout() {
    logout();
    navigate("/");
  }

  const location = useLocation();
  const onFeedbackPage = location.pathname === "/feedback";

  // Review attention badge. Poll on mount, on navigation (so it clears right
  // after the user views My submissions, which stamps reviews_seen_at), and
  // every 60s while the tab is open.
  useEffect(() => {
    if (!user) {
      setNotifCount(0);
      return;
    }
    let active = true;
    const fetchCount = () => {
      getReviewNotificationCount()
        .then((r) => {
          if (active) setNotifCount(r.count);
        })
        .catch(() => {
          /* best-effort — a failed poll shouldn't disrupt the nav */
        });
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [user, location.pathname]);

  const initial = user?.email?.[0]?.toUpperCase() ?? "?";
  const bg = user ? avatarColor(user.email) : AVATAR_COLORS[0];

  return (
    <>
      <nav className="civic-nav" aria-label="Primary">
        <div className="civic-nav-inner">
          <div className="civic-nav-left">
            <button
              ref={hamburgerRef}
              type="button"
              className="civic-nav-hamburger"
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              aria-controls="civic-nav-drawer"
              onClick={() => setDrawerOpen((v) => !v)}
            >
              <span aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <line x1="3" y1="6" x2="19" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <line x1="3" y1="11" x2="19" y2="11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <line x1="3" y1="16" x2="19" y2="16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
            </button>

            <Link to="/" className="civic-nav-wordmark" aria-label={`${hub.jurisdiction} home`}>
              {hub.name}
            </Link>

            {TOP_LINKS.length > 0 && (
              <ul className="civic-nav-links" role="list">
                {TOP_LINKS.map((l) => (
                  <li key={l.to}>
                    <NavLink to={l.to} end={l.end} className={navLinkClass}>
                      {l.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="civic-nav-right">
            {/* Slice 10.5 — desktop search bar between the primary
             * links and the avatar / sign-in cluster. Collapsed to an
             * icon by default; expands on click. Hidden on the mobile
             * drawer breakpoint via CSS (.civic-nav-search). */}
            <div className="civic-nav-search">
              <SearchBar />
            </div>

            <Link
              to="/feedback"
              className={`civic-nav-feedback${onFeedbackPage ? " is-active" : ""}`}
              aria-label="Give feedback"
            >
              Feedback
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M2 8.5L2 15.5L7 15.5L14 20L14 4L7 8.5Z" fill="currentColor"/>
                <ellipse cx="14" cy="12" rx="1.2" ry="4.5" fill="currentColor" opacity="0.3"/>
                <path d="M17 8.5C18.3 9.5 19 10.7 19 12C19 13.3 18.3 14.5 17 15.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
                <path d="M19.5 6.5C21.5 8 22.5 9.9 22.5 12C22.5 14.1 21.5 16 19.5 17.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
              </svg>
            </Link>

            {user ? (
              <>
                <button
                  ref={avatarRef}
                  type="button"
                  className="civic-nav-avatar"
                  style={{ background: bg }}
                  aria-label={`Account menu for ${user.email}`}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-controls="civic-nav-menu"
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  <span aria-hidden="true">{initial}</span>
                  {notifCount > 0 && (
                    <span
                      className="civic-nav-avatar-dot"
                      aria-label={`${notifCount} item${notifCount === 1 ? "" : "s"} need your attention`}
                    />
                  )}
                </button>
                {menuOpen && (
                  <div
                    ref={menuRef}
                    id="civic-nav-menu"
                    className="civic-nav-menu"
                    role="menu"
                    aria-label="Account menu"
                    onKeyDown={handleMenuKey}
                  >
                    <div className="civic-nav-menu-header" role="presentation">
                      Signed in as
                      <div className="civic-nav-menu-email">{user.email}</div>
                    </div>
                    <div className="civic-nav-menu-divider" role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      className="civic-nav-menu-item"
                      onClick={() => selectMenuItem(() => navigate("/my-submissions"))}
                    >
                      My submissions
                      {!isAdmin && notifCount > 0 && (
                        <span className="civic-nav-menu-badge">{notifCount}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="civic-nav-menu-item"
                      onClick={() => selectMenuItem(() => navigate("/settings"))}
                    >
                      Settings
                    </button>
                    {canPostAnnouncements && (
                      <button
                        type="button"
                        role="menuitem"
                        className="civic-nav-menu-item"
                        onClick={() =>
                          selectMenuItem(() => navigate("/announcement/new"))
                        }
                      >
                        Post announcement
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        role="menuitem"
                        className="civic-nav-menu-item"
                        onClick={() =>
                          selectMenuItem(() => navigate("/admin/reviews"))
                        }
                      >
                        Admin panel
                        {isAdmin && notifCount > 0 && (
                          <span className="civic-nav-menu-badge">{notifCount}</span>
                        )}
                      </button>
                    )}
                    <div className="civic-nav-menu-divider" role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      className="civic-nav-menu-item civic-nav-menu-item-danger"
                      onClick={() => selectMenuItem(handleLogout)}
                    >
                      Log out
                    </button>
                  </div>
                )}
              </>
            ) : (
              <button
                type="button"
                className="civic-nav-signin"
                onClick={() => setShowAuth(true)}
              >
                Sign in
              </button>
            )}
          </div>
        </div>

        {drawerOpen && (
          <div
            ref={drawerRef}
            id="civic-nav-drawer"
            className="civic-nav-drawer"
            role="dialog"
            aria-label="Site navigation"
          >
            {/* Slice 10.5 — search lives at the top of the mobile drawer
             * so a tap on the hamburger surfaces both navigation and
             * search. Submitting closes the drawer (onSubmitted). */}
            <div className="civic-nav-drawer-search">
              <SearchBar
                inDrawer
                onSubmitted={() => setDrawerOpen(false)}
              />
            </div>
            <ul className="civic-nav-drawer-links" role="list">
              {DRAWER_LINKS.map((l) => {
                const gated = hub.beta_mode && !user && !BETA_PUBLIC_PATHS.has(l.to);
                if (gated) {
                  return (
                    <li key={l.to}>
                      <span className="civic-nav-drawer-link civic-nav-drawer-link-gated">
                        {l.label}
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={l.to}>
                    <NavLink
                      to={l.to}
                      end={l.end}
                      className={({ isActive }) =>
                        `civic-nav-drawer-link${hub.beta_mode && !user ? " civic-nav-drawer-link-public" : ""}${isActive ? " is-active" : ""}`
                      }
                      onClick={() => setDrawerOpen(false)}
                    >
                      {l.label}
                    </NavLink>
                  </li>
                );
              })}
              <li className="civic-nav-drawer-divider" role="separator" aria-hidden="true" />
              {DRAWER_SECONDARY_LINKS.map((l) => (
                <li key={l.to}>
                  <NavLink
                    to={l.to}
                    className={({ isActive }) =>
                      `civic-nav-drawer-link${isActive ? " is-active" : ""}`
                    }
                    onClick={() => setDrawerOpen(false)}
                  >
                    {l.label}
                  </NavLink>
                </li>
              ))}
              {DRAWER_LEGAL_LINKS.map((l) => (
                <li key={l.to}>
                  <NavLink
                    to={l.to}
                    className={({ isActive }) =>
                      `civic-nav-drawer-link civic-nav-drawer-link-legal${isActive ? " is-active" : ""}`
                    }
                    onClick={() => setDrawerOpen(false)}
                  >
                    {l.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      {showAuth && (
        <AuthModal
          onComplete={() => setShowAuth(false)}
          onDismiss={() => setShowAuth(false)}
        />
      )}

    </>
  );
}

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `civic-nav-link${isActive ? " is-active" : ""}`;
}
