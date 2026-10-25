// Pages loaded when first opened (frontend pass, 2026-10-24). The home page
// (the feed) is in the main chunk; every other page is its own chunk, so a
// first visit downloads only what the page it lands on needs. The route
// tables (App.tsx, processes/) render them inside App's <Suspense>.
//
// No page waits on a click: once the first page has painted, preloadPages()
// fetches the resident pages in the background (and the admin pages for an
// admin), and React Router renders a navigation in a transition, so the page
// on screen stays until the next one's code is there.

import { lazy, type ComponentType } from "react";

type Loader = () => Promise<{ default: ComponentType<object> }>;
const residentLoaders: Loader[] = [];
const adminLoaders: Loader[] = [];

/** A lazily loaded page, its loader kept for preloadPages(). */
function page(load: Loader, admin = false) {
  (admin ? adminLoaders : residentLoaders).push(load);
  return lazy(load);
}

const draft = () => import("./pages/draft/kindPages");

/** Fetch the pages' code in the background: the resident pages, and an admin's too. */
export function preloadPages(admin: boolean): void {
  for (const load of [...residentLoaders, ...(admin ? adminLoaders : [])]) {
    load().catch(() => {
      // A failed preload is retried when the page is opened.
    });
  }
}

// A resident's reading
export const About = page(() => import("./pages/About"));
export const Search = page(() => import("./pages/Search"));
export const Members = page(() => import("./pages/Members"));
export const Privacy = page(() => import("./pages/Privacy"));
export const Terms = page(() => import("./pages/Terms"));
export const CodeOfConduct = page(() => import("./pages/CodeOfConduct"));
export const Feedback = page(() => import("./pages/Feedback"));
export const Welcome = page(() => import("./pages/Welcome"));
export const SignInLink = page(() => import("./pages/SignInLink"));
export const Votes = page(() => import("./pages/Votes"));
export const Process = page(() => import("./pages/Process"));
export const VoteLog = page(() => import("./pages/VoteLog"));
export const Propose = page(() => import("./pages/Propose"));
export const ProposalDetail = page(() => import("./pages/ProposalDetail"));
export const Projects = page(() => import("./pages/Projects"));
export const ProjectDetail = page(() => import("./pages/ProjectDetail"));
export const Deliberations = page(() => import("./pages/Deliberations"));
export const DeliberationDetail = page(() => import("./pages/DeliberationDetail"));
export const Outcomes = page(() => import("./pages/Outcomes"));
export const BriefPage = page(() => import("./pages/Brief"));
export const AnnouncementPage = page(() => import("./pages/Announcement"));
export const MeetingSummary = page(() => import("./pages/MeetingSummary"));
export const VoteResults = page(() => import("./pages/VoteResults"));
export const WordCloud = page(() => import("./pages/WordCloud"));

// Admin
export const AdminReviews = page(() => import("./pages/AdminReviews"), true);
export const AdminSettings = page(() => import("./pages/AdminSettings"), true);
export const AdminModeration = page(() => import("./pages/AdminModeration"), true);
export const AdminArchived = page(() => import("./pages/AdminArchived"), true);
export const AdminEdits = page(() => import("./pages/AdminEdits"), true);
export const AdminFeedback = page(() => import("./pages/AdminFeedback"), true);
export const ContactCivicSocial = page(() => import("./pages/ContactCivicSocial"), true);
export const AdminBriefs = page(() => import("./pages/AdminBriefs"), true);
export const AdminVoteResults = page(() => import("./pages/AdminVoteResults"), true);
export const AdminMeetingSummaries = page(() => import("./pages/AdminMeetingSummaries"), true);

// A resident's own settings and submissions
export const Settings = page(() => import("./pages/Settings"));
export const MySubmissions = page(() => import("./pages/MySubmissions"));

// Drafting
export const NewConversation = page(() => draft().then((m) => ({ default: m.NewConversation })));
export const NewProject = page(() => draft().then((m) => ({ default: m.NewProject })));
export const NewProposal = page(() => draft().then((m) => ({ default: m.NewProposal })));
export const NewVote = page(() => draft().then((m) => ({ default: m.NewVote })));
export const PostAnnouncement = page(() => import("./pages/PostAnnouncement"));
export const CreateWordCloud = page(() => import("./pages/CreateWordCloud"));
