import { Fragment, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, Link } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./context/authState";
import { useHub } from "./config/hub";
import { whenPlugin } from "./config/plugins";
import { PROCESS_UI } from "./processes";
import { FEATURE_UI, featurePageTops, featureSpaceLinks } from "./features";
import { detailPathOf, pluginOfType } from "./processes/display";
import { ArchiveSlotProvider } from "./components/archiveSlot";
import DetailActions from "./components/DetailActions";
import ShareBanner from "./components/ShareBanner";
import { isBetaPublicPath } from "./config/betaPublicPaths";
import Nav from "./components/Nav";
import Sidebar from "./components/Sidebar";
import AdminDrawer from "./components/AdminDrawer";
import { isAdminPath } from "./hooks/useAdminNav";
import { ColumnSlotContext } from "./context/columnSlot";
import { ChipGroup } from "./kit";
import { applyAppearance, storedAppearance, type Appearance } from "./config/appearance";
import BottomBar from "./components/BottomBar";
import { NavDataProvider } from "./context/NavDataContext";
import { navLayout } from "./config/navigation";
import HubBanner from "./components/HubBanner";
import { WelcomeStripSlot } from "./components/PackageSlots";
import FeedVotesTabs from "./components/FeedVotesTabs";
import Home from "./pages/Home";
import ProcessLink, { type ProcessLinkPage } from "./pages/ProcessLink";
import {
  About,
  AdminArchived,
  AdminEdits,
  AdminModeration,
  AdminReviews,
  AdminSettings,
  CodeOfConduct,
  ContactCivicSocial,
  MySubmissions,
  Privacy,
  Settings,
  SignInLink,
  KitGallery,
  Terms,
  Welcome,
  preloadPages,
} from "./lazyPages";
import { adminAnchorPath } from "../../src/shared/adminAnchors";
import { recordPage } from "./services/lastPage";
import IntroPopup from "./components/IntroPopup";
import { hasSeenIntro } from "./components/introSeen";
import ReAcceptModal from "./components/ReAcceptModal";
import HubReadyDialog from "./components/HubReadyDialog";
import AboutYouCard from "./components/AboutYouCard";
import { arrivingFromStartPage, hubJustCreated } from "./utils/hubJustCreated";
import BetaBanner from "./components/BetaBanner";
import DemoBanner from "./components/DemoBanner";
import { forgetClosedNoticeOnLive } from "./components/modeNoticeState";
import BetaWelcomeDialog from "./components/BetaWelcomeDialog";
import { usePreviewMode } from "./hooks/usePreviewMode";
import { useIsWideViewport } from "./hooks/useIsWideViewport";
import { useTypingFocus } from "./hooks/useTypingFocus";
import { useMediaQuery } from "./hooks/useMediaQuery";
import AsideColumn from "./aside/AsideColumn";
import { THREE_COLUMN_QUERY, pageHasAside } from "./aside/asidePages";
import AuthModal from "./components/AuthModal";
import "./App.css";

// Routes that show the hub's banner photo: the masthead is on Feed and About
// only (navigation polish, Adam, 2026-10-14), so a section page opens at its
// own header with an item in view on a phone, and detail and drafting pages
// stay compact.
const BANNER_ROUTES = new Set(["/", "/about"]);

/** /admin#<anchor>: a tab, a Settings section or a plugin's panel (src/shared/adminAnchors.ts). */
function AdminAnchor() {
  const { hash } = useLocation();
  return <Navigate to={adminAnchorPath(hash, "admin") ?? "/admin/reviews"} replace />;
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, loading } = useAuth();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(false);
  if (loading) return null;
  if (isAdmin) return <>{children}</>;

  if (user) {
    // Signed in, not an admin. This used to bounce to the home page with no
    // explanation — which is what an admin-review link from an email did when
    // tapped on a phone signed in as the CREATOR (Adam, 2026-09-05). An admin
    // review and the creator's own view of it share the review id, so send
    // them to their submission — where they can read it and withdraw it —
    // rather than to nowhere.
    const review = pathname.match(/^\/admin\/reviews\/([^/]+)/);
    return <Navigate to={review ? `/my-submissions/${review[1]}` : "/my-submissions"} replace />;
  }

  // Signed out. Sign in HERE, in place, instead of navigating away: the URL
  // survives, so an admin who opens a review link from an email on a phone
  // lands on that review the moment they finish signing in. Dismissing the
  // modal is the one case that goes home.
  if (dismissed) return <Navigate to="/" replace />;
  return <AuthModal onComplete={() => {}} onDismiss={() => setDismissed(true)} />;
}

/**
 * Every process type's pages, from its UI module (src/processes/): each in
 * whenPlugin(<the type's plugin>) and, for an admin page, <AdminGuard>.
 */
function processRoutes() {
  return PROCESS_UI.flatMap((ui) => {
    const plugin = pluginOfType(ui.type);
    // The type's detail page (its manifest's detailPath) carries the
    // framework's archive control (components/archiveSlot.tsx).
    const detail = detailPathOf(ui.type, ":id");
    return ui.routes.filter((r) => r.path !== PROCESS_LINK).map((r) => {
      const element =
        r.path === detail && !r.admin ? (
          <ArchiveSlotProvider type={ui.type} row={DetailActions}>
            {r.element}
          </ArchiveSlotProvider>
        ) : (
          r.element
        );
      const page = r.admin ? <AdminGuard>{element}</AdminGuard> : element;
      return <Route key={`${ui.type} ${r.path}`} path={r.path} element={!plugin ? page : whenPlugin(plugin, page)} />;
    });
  });
}

/**
 * /process/:id is the kernel's (pages/ProcessLink.tsx): a type whose page
 * lives there registers it, and the kernel hands the link to it while its
 * plugin is on, else sends the link to the process's own type's page.
 */
const PROCESS_LINK = "/process/:id";
const processLinkPages: ProcessLinkPage[] = PROCESS_UI.flatMap((ui) =>
  ui.routes
    .filter((r) => r.path === PROCESS_LINK && !r.admin)
    .map((r) => ({
      type: ui.type,
      plugin: pluginOfType(ui.type),
      element:
        detailPathOf(ui.type, ":id") === PROCESS_LINK ? (
          <ArchiveSlotProvider type={ui.type} row={DetailActions}>
            {r.element}
          </ArchiveSlotProvider>
        ) : (
          r.element
        ),
    })),
);

function processLinkRoute() {
  return <Route key="process-link" path={PROCESS_LINK} element={<ProcessLink pages={processLinkPages} />} />;
}

/** Every feature package's pages (ui/src/features.ts), each behind its feature's switch. */
function featureRoutes() {
  return FEATURE_UI.flatMap((ui) =>
    ui.routes.map((r) => {
      const page = r.admin ? <AdminGuard>{r.element}</AdminGuard> : r.element;
      return <Route key={`${ui.feature} ${r.path}`} path={r.path} element={whenPlugin(ui.feature, page)} />;
    }),
  );
}

function BannerSlot() {
  const { pathname } = useLocation();
  if (!BANNER_ROUTES.has(pathname)) return null;
  return <HubBanner />;
}


function AppContent() {
  // The routes and banners follow the plugin switches and the mode. Every
  // component that reads the hub holds useHub() itself (ADR-013), so a
  // Settings save reaches it whether or not this re-renders it.
  const hub = useHub();
  // A hub's creator arriving from the start page gets "Your hub is ready"
  // instead of the visitor's popup (2026-10-08).
  const [showIntro, setShowIntro] = useState(() => !hasSeenIntro() && !arrivingFromStartPage());
  const { user, isAdmin, loading } = useAuth();
  // Once the first page has painted, fetch the other pages' code in the
  // background, so no later click waits on it (lazyPages.ts).
  useEffect(() => {
    if (loading) return;
    const run = () => preloadPages(isAdmin);
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(run, 1000);
    return () => window.clearTimeout(id);
  }, [loading, isAdmin]);
  const [readyClosed, setReadyClosed] = useState(false);
  const showReady = Boolean(user) && !readyClosed && hubJustCreated();
  const preview = usePreviewMode();
  const { pathname } = useLocation();
  const wide = useIsWideViewport();
  // A phone hides its tab bar and folds the Save bar while you type.
  useTypingFocus();
  // The page a bug report is about, whichever link opened the form.
  useEffect(() => recordPage(pathname), [pathname]);

  // Private-beta front door. A logged-out first-time visitor lands on the
  // real app with BetaWelcomeDialog floating over it (sign in / waitlist /
  // browse) — every dismissal enters read-only preview. The backend
  // allow-list is the real account gate; `preview` only tracks whether the
  // visitor has been through the front door this session. BetaBanner keeps
  // the beta state visible from there.
  //
  // Never over a standalone info/legal page: the sign-up consent line and
  // the re-acceptance modal open Terms / Privacy / Code of Conduct in a new
  // tab, which has no session preview flag — without this gate the dialog
  // would land on top of the very page the visitor clicked through to read.
  const showWelcomeDialog =
    hub.beta_mode && !user && !loading && !preview && !isBetaPublicPath(pathname);

  // While a logged-out visitor browses in beta preview, the persistent banner
  // is enough of an onboarding cue — suppress the intro popup so we don't stack
  // two overlays on top of the read-only experience.
  const inBetaPreview = hub.beta_mode && !user;

  // Where the sections are drawn at desktop width (Hub settings → Theme →
  // Navigation); phones get the bottom bar under either (navigation slice,
  // 2026-10-14). The layout rules are in App.css.
  // Admin always uses the left rail, whatever the public layout (pilot
  // readiness 3, Adam 2026-11-06): the hub header stays, the section tabs are
  // not drawn, and the column is the admin rail. On a phone the bottom bar
  // keeps the hub's tabs and the rail is a drawer (AdminDrawer.tsx).
  const inAdmin = isAdmin && isAdminPath(pathname);
  const chosen = inAdmin ? "sidebar" : navLayout();
  // Three columns is the left column plus a right column of cards (ADR-019),
  // on the pages that have one (aside/asidePages.ts). From 1280px the three
  // sit side by side, edge to edge, the feed centred between (the River's
  // layout, Adam 2026-11-07). Narrower, the right column goes first, on every
  // page; at phone width the left column gives way to the phone's bar, as in
  // every layout.
  const layout = chosen === "three_columns" ? "sidebar" : chosen;
  const threeWide = useMediaQuery(THREE_COLUMN_QUERY);
  const asideColumn = chosen === "three_columns" && pageHasAside(pathname) && threeWide;
  // Left column and Three columns are one look on the public side (Adam,
  // 2026-11-07, after dev): the navigation a rounded card, the feed between
  // even gaps (--gap-columns), and a masthead (the beta or demo bar, the word cloud
  // teaser, the banner photo) across the full width above the columns, as in
  // Top navigation. Left column is Three columns without its right column.
  // The rules are in App.css and Sidebar.css (.app--card-layout).
  const cardLayout = !inAdmin && layout === "sidebar";
  const masthead = cardLayout && wide;
  // Beside the admin rail, the hub's bars head the content column, so the
  // rail starts at the top of the screen and its foot is never pushed off.
  const bannersInColumn = layout === "sidebar" && wide && !cardLayout;
  const teaserAndBanner = (
    <>
      {/* What packages add to the strip (Word clouds' teaser), while their plugin is on. */}
      {!inAdmin && <WelcomeStripSlot />}
      <BannerSlot />
    </>
  );
  const [columnSlot, setColumnSlot] = useState<HTMLElement | null>(null);
  forgetClosedNoticeOnLive(hub.config?.hub.mode);
  const hubBanners = (
    <>
      {/* One always-on beta bar for everyone — signed-in testers and
          signed-out preview browsers get the same demo-data reminder
          (the waitlist CTA inside it is signed-out-only). Gone entirely
          (zero code change) when beta_mode flips off. */}
      {hub.beta_mode && <BetaBanner />}
      {/* Demo hubs (Phase 7): explains the Sample badge; admins get the
          link to remove the sample content. */}
      {hub.demo_mode && <DemoBanner />}
      {/* A feature's line across the top of every public page (Pinning's urgent pin). */}
      {!inAdmin && featurePageTops((id) => hub.plugins.enabled(id)).map(({ feature, Top }) => <Top key={feature} />)}
    </>
  );

  return (
    <ColumnSlotContext.Provider value={{ slot: layout === "sidebar" && wide ? columnSlot : null, setSlot: setColumnSlot }}>
    <div
      className={`app app--nav-${layout === "sidebar" ? "sidebar" : "tabs"}${cardLayout ? " app--card-layout" : ""}${asideColumn ? " app--three" : ""}${inAdmin ? " app--admin" : ""}`}
    >
      {showIntro && !inBetaPreview && !showReady && (
        <IntroPopup onDismiss={() => setShowIntro(false)} />
      )}
      {showReady && <HubReadyDialog email={user?.email ?? ""} onDismiss={() => setReadyClosed(true)} />}
      {/* The one-time About-you card, shown before a member first takes part (districts and demographics). */}
      <AboutYouCard />

      {!bannersInColumn && hubBanners}

      {showWelcomeDialog && <BetaWelcomeDialog />}

      <Nav />
      {masthead && <div className="app-masthead">{teaserAndBanner}</div>}
      <div className="app-frame">
        {layout === "sidebar" && <Sidebar />}
        <div className="app-column">
          {bannersInColumn && hubBanners}
          {!masthead && teaserAndBanner}
          {!inAdmin && <FeedVotesTabs />}

          {/* One share banner for the hub: a page's share moment, when its bar is off screen. */}
          {!inAdmin && <ShareBanner />}

          <main className="page-shell">
            {inAdmin && !wide && <AdminDrawer />}
            {/* Every page but the feed loads its code when first needed (lazyPages.ts). */}
            <Suspense fallback={<p className="page-loading" aria-busy="true">Loading…</p>}>
              <Routes>
                <Route path="/" element={<Home />} />
                {processLinkRoute()}
                {processRoutes()}
                {featureRoutes()}
                <Route path="/my-submissions" element={<MySubmissions />} />
                <Route path="/my-submissions/:reviewId" element={<MySubmissions />} />
                <Route path="/kit" element={<AdminGuard><KitGallery /></AdminGuard>} />
                <Route path="/admin" element={<AdminGuard><AdminAnchor /></AdminGuard>} />
                <Route path="/admin/reviews" element={<AdminGuard><AdminReviews /></AdminGuard>} />
                <Route path="/admin/reviews/:reviewId" element={<AdminGuard><AdminReviews /></AdminGuard>} />
                <Route path="/admin/settings" element={<AdminGuard><AdminSettings /></AdminGuard>} />
                <Route path="/admin/settings/:section" element={<AdminGuard><AdminSettings /></AdminGuard>} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/about" element={<About />} />
                {/* Slice 11 — legal pages. Routes resolve via React Router so
                    cross-document links (Terms → Privacy etc.) don't trigger
                    full-page reloads. */}
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/code-of-conduct" element={<CodeOfConduct />} />
                <Route path="/welcome" element={<Welcome />} />
                <Route path="/sign-in" element={<SignInLink />} />
                {/* Slice 11 — admin moderation log. Read-only list of every
                    moderation action, gated server-side via requireAdmin
                    and client-side via the AuthContext.isAdmin flag inside
                    the page. */}
                <Route path="/admin/moderation" element={<AdminGuard><AdminModeration /></AdminGuard>} />
                <Route path="/admin/archived" element={<AdminGuard><AdminArchived /></AdminGuard>} />
                <Route path="/admin/edits" element={<AdminGuard><AdminEdits /></AdminGuard>} />
                {/* An admin writes to Civic.Social directly (feedback routing).
                    Not behind any plugin. */}
                <Route path="/admin/contact-civic-social" element={<AdminGuard><ContactCivicSocial /></AdminGuard>} />
              </Routes>
            </Suspense>
          </main>

          <SiteFooter />
        </div>
        {asideColumn && <AsideColumn />}
      </div>

      <BottomBar />

      {/* Slice 11 — re-acceptance modal. Self-mounts when the signed-in
          user's stored legal version is null or older than the current
          bundle. Blocking — user can't interact with the app until
          they accept or sign out. */}
      {/* After "Your hub is ready", not on top of it. */}
      {!showReady && <ReAcceptModal />}
    </div>
    </ColumnSlotContext.Provider>
  );
}

const SOURCE_CODE_URL =
  import.meta.env.VITE_SOURCE_CODE_URL || "https://github.com/Mosaic-Foundation/civic-hub";

function SiteFooter() {
  const hub = useHub();
  const { user, loading } = useAuth();
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <div className="app-footer-brand">
          <strong>{hub.name}</strong>
          <span className="app-footer-tagline">
            {/* The hub's own operator (legal.operator_name, Settings → Legal).
                This named one person on every hub until 2026-09-24; a hub
                that has not said who runs it now says nothing here. */}
            {hub.operator_name && <>Operated by {hub.operator_name} · </>}
            Powered by{" "}
            <a
              href="https://civic.social"
              target="_blank"
              rel="noopener noreferrer"
            >
              Civic Social
            </a>
          </span>
        </div>
        <nav className="app-footer-links" aria-label="Legal and feedback">
          {/* A feature's page for everyone (Feedback's form), while it is on. */}
          {featureSpaceLinks((id) => hub.plugins.enabled(id)).map((l) => (
            <Fragment key={l.feature}>
              <Link to={l.path}>{l.longLabel}</Link>
              <span aria-hidden="true">·</span>
            </Fragment>
          ))}
          <Link to="/privacy">Privacy</Link>
          <span aria-hidden="true">·</span>
          <Link to="/terms">Terms</Link>
          <span aria-hidden="true">·</span>
          <Link to="/code-of-conduct">Code of Conduct</Link>
          <span aria-hidden="true">·</span>
          {/* AGPL-3.0 section 13: everyone who uses the hub over the network
              is offered its source. A hub running modified code must point
              this at its own source (VITE_SOURCE_CODE_URL). */}
          <a href={SOURCE_CODE_URL} target="_blank" rel="noopener noreferrer">
            Source code
          </a>
        </nav>
        {/* A signed-out reader's look (design pass, decision 9); a signed-in
            person sets theirs in Your settings, on their account. */}
        {!loading && !user && <FooterAppearance />}
      </div>
    </footer>
  );
}


export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NavDataProvider>
          <AppContent />
        </NavDataProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

function FooterAppearance() {
  const [pref, setPref] = useState<Appearance>(() => storedAppearance() ?? "system");
  return (
    <ChipGroup
      className="app-footer-appearance"
      label="Appearance"
      value={pref}
      onChange={(v) => {
        setPref(v);
        applyAppearance(v);
      }}
      options={[
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
        { value: "system", label: "Device", title: "Follow this device" },
      ]}
    />
  );
}
