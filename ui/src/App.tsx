import { Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, Link } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./context/authState";
import { useHub } from "./config/hub";
import { whenPlugin } from "./config/plugins";
import { PROCESS_UI } from "./processes";
import { FEATURE_UI } from "./features";
import { pluginOfType } from "./processes/display";
import ShareBanner from "./components/ShareBanner";
import { BETA_PUBLIC_PATHS } from "./config/betaPublicPaths";
import Nav from "./components/Nav";
import Sidebar from "./components/Sidebar";
import BottomBar from "./components/BottomBar";
import { NavDataProvider } from "./context/NavDataContext";
import { navLayout } from "./config/navigation";
import HubBanner from "./components/HubBanner";
import WordcloudTeaser from "./components/WordcloudTeaser";
import FeedVotesTabs from "./components/FeedVotesTabs";
import Home from "./pages/Home";
import {
  About,
  AdminArchived,
  AdminEdits,
  AdminFeedback,
  AdminModeration,
  AdminReviews,
  AdminSettings,
  CodeOfConduct,
  ContactCivicSocial,
  Feedback,
  Members,
  MySubmissions,
  Privacy,
  Search as SearchPage,
  Settings,
  SignInLink,
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
import { arrivingFromStartPage, hubJustCreated } from "./utils/hubJustCreated";
import BetaBanner from "./components/BetaBanner";
import DemoBanner from "./components/DemoBanner";
import { forgetClosedNoticeOnLive } from "./components/modeNoticeState";
import BetaWelcomeDialog from "./components/BetaWelcomeDialog";
import { usePreviewMode } from "./hooks/usePreviewMode";
import { useIsWideViewport } from "./hooks/useIsWideViewport";
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
    return ui.routes.map((r) => {
      const page = r.admin ? <AdminGuard>{r.element}</AdminGuard> : r.element;
      return <Route key={`${ui.type} ${r.path}`} path={r.path} element={r.ungated || !plugin ? page : whenPlugin(plugin, page)} />;
    });
  });
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
    hub.beta_mode && !user && !loading && !preview && !BETA_PUBLIC_PATHS.has(pathname);

  // While a logged-out visitor browses in beta preview, the persistent banner
  // is enough of an onboarding cue — suppress the intro popup so we don't stack
  // two overlays on top of the read-only experience.
  const inBetaPreview = hub.beta_mode && !user;

  // Where the sections are drawn at desktop width (Hub settings → Theme →
  // Navigation); phones get the bottom bar under either (navigation slice,
  // 2026-10-14). The layout rules are in App.css.
  const layout = navLayout();
  // Beside the sidebar, the hub's bars head the content column, so the
  // sidebar starts at the top of the screen and its foot is never pushed off.
  const bannersInColumn = layout === "sidebar" && wide;
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
    </>
  );

  return (
    <div className={`app app--nav-${layout === "sidebar" ? "sidebar" : "tabs"}`}>
      {showIntro && !inBetaPreview && !showReady && (
        <IntroPopup onDismiss={() => setShowIntro(false)} />
      )}
      {showReady && <HubReadyDialog email={user?.email ?? ""} onDismiss={() => setReadyClosed(true)} />}

      {!bannersInColumn && hubBanners}

      {showWelcomeDialog && <BetaWelcomeDialog />}

      <Nav />
      <div className="app-frame">
        {layout === "sidebar" && <Sidebar />}
        <div className="app-column">
          {bannersInColumn && hubBanners}
          {/* Hidden when the hub switched the plugin off (config/plugins.tsx). */}
          {hub.plugins.enabled("wordcloud") && <WordcloudTeaser />}
          <BannerSlot />
          <FeedVotesTabs />

          {/* One share banner for the hub: a page's share moment, when its bar is off screen. */}
          <ShareBanner />

          <main className="page-shell">
            {/* Every page but the feed loads its code when first needed (lazyPages.ts). */}
            <Suspense fallback={<p className="page-loading" aria-busy="true">Loading…</p>}>
              <Routes>
                <Route path="/" element={<Home />} />
                {processRoutes()}
                {featureRoutes()}
                <Route path="/my-submissions" element={<MySubmissions />} />
                <Route path="/my-submissions/:reviewId" element={<MySubmissions />} />
                <Route path="/admin" element={<AdminGuard><AdminAnchor /></AdminGuard>} />
                <Route path="/admin/reviews" element={<AdminGuard><AdminReviews /></AdminGuard>} />
                <Route path="/admin/reviews/:reviewId" element={<AdminGuard><AdminReviews /></AdminGuard>} />
                <Route path="/admin/settings" element={<AdminGuard><AdminSettings /></AdminGuard>} />
                <Route path="/admin/settings/:section" element={<AdminGuard><AdminSettings /></AdminGuard>} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/members" element={whenPlugin("members", <Members />)} />
                <Route path="/about" element={<About />} />
                <Route path="/search" element={whenPlugin("search", <SearchPage />)} />
                {/* Slice 11 — legal pages. Routes resolve via React Router so
                    cross-document links (Terms → Privacy etc.) don't trigger
                    full-page reloads. */}
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/code-of-conduct" element={<CodeOfConduct />} />
                {/* Slice 14 — operator-facing feedback form. Open to anonymous
                    and signed-in users; submissions persist to the
                    feedback_submissions table and best-effort email the operator. */}
                <Route path="/welcome" element={<Welcome />} />
                <Route path="/sign-in" element={<SignInLink />} />
                <Route path="/feedback" element={whenPlugin("feedback", <Feedback />)} />
                {/* Slice 11 — admin moderation log. Read-only list of every
                    moderation action, gated server-side via requireAdmin
                    and client-side via the AuthContext.isAdmin flag inside
                    the page. */}
                <Route path="/admin/moderation" element={<AdminGuard><AdminModeration /></AdminGuard>} />
                <Route path="/admin/archived" element={<AdminGuard><AdminArchived /></AdminGuard>} />
                <Route path="/admin/edits" element={<AdminGuard><AdminEdits /></AdminGuard>} />
                {/* Read-only archive of resident feedback, incl. topic suggestions. */}
                <Route path="/admin/feedback" element={whenPlugin("feedback", <AdminGuard><AdminFeedback /></AdminGuard>)} />
                {/* An admin writes to Civic.Social directly (feedback routing).
                    Not behind the Feedback plugin. */}
                <Route path="/admin/contact-civic-social" element={<AdminGuard><ContactCivicSocial /></AdminGuard>} />
              </Routes>
            </Suspense>
          </main>

          <SiteFooter />
        </div>
      </div>

      <BottomBar />

      {/* Slice 11 — re-acceptance modal. Self-mounts when the signed-in
          user's stored legal version is null or older than the current
          bundle. Blocking — user can't interact with the app until
          they accept or sign out. */}
      {/* After "Your hub is ready", not on top of it. */}
      {!showReady && <ReAcceptModal />}
    </div>
  );
}

function SiteFooter() {
  const hub = useHub();
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
          {/* Gone with the Feedback plugin (config/plugins.tsx). */}
          {hub.plugins.enabled("feedback") && (
            <>
              <Link to="/feedback">Send feedback</Link>
              <span aria-hidden="true">·</span>
            </>
          )}
          <Link to="/privacy">Privacy</Link>
          <span aria-hidden="true">·</span>
          <Link to="/terms">Terms</Link>
          <span aria-hidden="true">·</span>
          <Link to="/code-of-conduct">Code of Conduct</Link>
        </nav>
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
