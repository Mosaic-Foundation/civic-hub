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
export const Privacy = page(() => import("./pages/Privacy"));
export const Terms = page(() => import("./pages/Terms"));
export const CodeOfConduct = page(() => import("./pages/CodeOfConduct"));
export const Welcome = page(() => import("./pages/Welcome"));
export const SignInLink = page(() => import("./pages/SignInLink"));
// The kit's gallery (Events 3): admins only, in the public layout.
export const KitGallery = page(() => import("./pages/KitGallery"));

// Admin
export const AdminReviews = page(() => import("./pages/AdminReviews"), true);
export const AdminSettings = page(() => import("./pages/AdminSettings"), true);
export const AdminModeration = page(() => import("./pages/AdminModeration"), true);
export const AdminArchived = page(() => import("./pages/AdminArchived"), true);
export const AdminEdits = page(() => import("./pages/AdminEdits"), true);
export const ContactCivicSocial = page(() => import("./pages/ContactCivicSocial"), true);

// A resident's own settings and submissions
export const Settings = page(() => import("./pages/Settings"));
export const MySubmissions = page(() => import("./pages/MySubmissions"));
