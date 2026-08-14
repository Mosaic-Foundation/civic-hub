import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, Link } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import hub from "./config/hub";
import Nav from "./components/Nav";
import BetaLanding from "./pages/BetaLanding";
import HubBanner from "./components/HubBanner";
import WordcloudTeaser from "./components/WordcloudTeaser";
import FeedVotesTabs from "./components/FeedVotesTabs";
import Home from "./pages/Home";
import Votes from "./pages/Votes";
import Process from "./pages/Process";
import About from "./pages/About";
import SearchPage from "./pages/Search";
import Propose from "./pages/Propose";
import ProposeDraft from "./pages/ProposeDraft";
import ProposeDraftVote from "./pages/ProposeDraftVote";
import ProposalDetail from "./pages/ProposalDetail";
import AdminProposals from "./pages/AdminProposals";
import AdminVoteResults from "./pages/AdminVoteResults";
import AdminBriefs from "./pages/AdminBriefs";
import AdminMeetingSummaries from "./pages/AdminMeetingSummaries";
import AdminSettings from "./pages/AdminSettings";
import VoteResults from "./pages/VoteResults";
import BriefPage from "./pages/Brief";
import MeetingSummary from "./pages/MeetingSummary";
import VoteLog from "./pages/VoteLog";
import PostAnnouncement from "./pages/PostAnnouncement";
import AnnouncementPage from "./pages/Announcement";
import Settings from "./pages/Settings";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import CodeOfConduct from "./pages/CodeOfConduct";
import Feedback from "./pages/Feedback";
import Welcome from "./pages/Welcome";
import Projects from "./pages/Projects";
import Deliberations from "./pages/Deliberations";
import ConversationDraft from "./pages/ConversationDraft";
import DeliberationDetail from "./pages/DeliberationDetail";
import ProjectDetail from "./pages/ProjectDetail";
import ProjectDraft from "./pages/ProjectDraft";
import AdminModeration from "./pages/AdminModeration";
import AdminArchived from "./pages/AdminArchived";
import AdminReviews from "./pages/AdminReviews";
import MySubmissions from "./pages/MySubmissions";
import WordCloud from "./pages/WordCloud";
import CreateWordCloud from "./pages/CreateWordCloud";
import IntroPopup, { hasSeenIntro } from "./components/IntroPopup";
import ReAcceptModal from "./components/ReAcceptModal";
import PreviewBanner from "./components/PreviewBanner";
import { usePreviewMode } from "./hooks/usePreviewMode";
import "./App.css";

// Routes that show the hub banner above the nav. Detail/action pages
// (/process/:id, /propose, etc.) stay compact so task-focused flows are
// not pushed down by 200px of imagery.
const BANNER_ROUTES = new Set(["/", "/votes", "/propose", "/projects", "/deliberations"]);

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAuth();
  if (loading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function BannerSlot() {
  const { pathname } = useLocation();
  if (!BANNER_ROUTES.has(pathname)) return null;
  return <HubBanner />;
}


function AppContent() {
  const [showIntro, setShowIntro] = useState(() => !hasSeenIntro());
  const { user, loading } = useAuth();
  const preview = usePreviewMode();

  // Private-beta splash. A logged-out visitor sees BetaLanding until they opt
  // into read-only preview ("Browse the site"). The backend allow-list is the
  // real account gate; `preview` only relaxes this front-end wall so people
  // can look around. Once in preview we fall through to the full app below,
  // where PreviewBanner keeps the beta state visible.
  if (hub.beta_mode && !user && !loading && !preview) {
    return (
      <div className="app">
        <Nav />
        <WordcloudTeaser />
        <main className="page-shell">
          <Routes>
            <Route path="/welcome" element={<Welcome />} />
            <Route path="/about" element={<About />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/code-of-conduct" element={<CodeOfConduct />} />
            <Route path="/feedback" element={<Feedback />} />
            <Route path="*" element={<BetaLanding />} />
          </Routes>
        </main>
        <SiteFooter />
      </div>
    );
  }

  // While a logged-out visitor browses in beta preview, the persistent banner
  // is enough of an onboarding cue — suppress the intro popup so we don't stack
  // two overlays on top of the read-only experience.
  const inBetaPreview = hub.beta_mode && !user;

  return (
    <div className="app">
      {showIntro && !inBetaPreview && (
        <IntroPopup onDismiss={() => setShowIntro(false)} />
      )}

      {inBetaPreview && <PreviewBanner />}

      <Nav />
      <WordcloudTeaser />
      <BannerSlot />
      <FeedVotesTabs />

      <main className="page-shell">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/votes" element={<Votes />} />
          <Route path="/process/:id" element={<Process />} />
          <Route path="/propose" element={<Propose />} />
          <Route path="/propose/new" element={<ProposeDraft />} />
          <Route path="/votes/new" element={<ProposeDraftVote />} />
          <Route path="/proposal/:id" element={<ProposalDetail />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/new" element={<ProjectDraft />} />
          <Route path="/project/:id" element={<ProjectDetail />} />
          <Route path="/deliberations" element={<Deliberations />} />
          <Route path="/deliberations/new" element={<ConversationDraft />} />
          <Route path="/deliberation/:id" element={<DeliberationDetail />} />
          <Route path="/wordcloud/new" element={<CreateWordCloud />} />
          <Route path="/wordcloud/:id" element={<WordCloud />} />
          <Route path="/votes/:id/log" element={<VoteLog />} />
          <Route path="/my-submissions" element={<MySubmissions />} />
          <Route path="/my-submissions/:reviewId" element={<MySubmissions />} />
          <Route path="/admin/reviews" element={<AdminGuard><AdminReviews /></AdminGuard>} />
          <Route path="/admin/reviews/:reviewId" element={<AdminGuard><AdminReviews /></AdminGuard>} />
          <Route path="/admin/proposals" element={<AdminGuard><AdminProposals /></AdminGuard>} />
          {/* Legacy vote-results admin (existing published vote briefs keep
              their review screen); the Briefs tab now points at /admin/briefs. */}
          <Route path="/admin/vote-results" element={<AdminGuard><AdminVoteResults /></AdminGuard>} />
          <Route path="/admin/vote-results/:id" element={<AdminGuard><AdminVoteResults /></AdminGuard>} />
          {/* Unified Briefs queue — the universal admin results surface. */}
          <Route path="/admin/briefs" element={<AdminGuard><AdminBriefs /></AdminGuard>} />
          <Route path="/admin/briefs/:id" element={<AdminGuard><AdminBriefs /></AdminGuard>} />
          <Route
            path="/admin/meeting-summaries"
            element={<AdminGuard><AdminMeetingSummaries /></AdminGuard>}
          />
          <Route
            path="/admin/meeting-summaries/:id"
            element={<AdminGuard><AdminMeetingSummaries /></AdminGuard>}
          />
          <Route path="/admin/settings" element={<AdminGuard><AdminSettings /></AdminGuard>} />
          <Route path="/vote-results/:id" element={<VoteResults />} />
          {/* Public brief page — the permanent record of a completed process
              (the /brief path is reclaimed from the old Slice 8.5 redirect;
              existing published vote-results stay at /vote-results/:id). */}
          <Route path="/brief/:id" element={<BriefPage />} />
          <Route path="/meeting-summary/:id" element={<MeetingSummary />} />
          <Route path="/announcement/new" element={<PostAnnouncement />} />
          <Route path="/announcement/:id/edit" element={<PostAnnouncement />} />
          <Route path="/announcement/:id" element={<AnnouncementPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/about" element={<About />} />
          <Route path="/search" element={<SearchPage />} />
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
          <Route path="/feedback" element={<Feedback />} />
          {/* Slice 11 — admin moderation log. Read-only list of every
              moderation action, gated server-side via requireAdmin
              and client-side via the AuthContext.isAdmin flag inside
              the page. */}
          <Route path="/admin/moderation" element={<AdminGuard><AdminModeration /></AdminGuard>} />
          <Route path="/admin/archived" element={<AdminGuard><AdminArchived /></AdminGuard>} />
        </Routes>
      </main>

      <SiteFooter />

      {/* Slice 11 — re-acceptance modal. Self-mounts when the signed-in
          user's stored legal version is null or older than the current
          bundle. Blocking — user can't interact with the app until
          they accept or sign out. */}
      <ReAcceptModal />
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <div className="app-footer-brand">
          <strong>{hub.name}</strong>
          <span className="app-footer-tagline">
            Operated by Adam Lake · Powered by{" "}
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
          <Link to="/feedback">Send feedback</Link>
          <span aria-hidden="true">·</span>
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
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}
