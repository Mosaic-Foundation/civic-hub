// The numbers the hub's navigation shows, read once for every place that
// draws it: the header, the phone's bar and More sheet, and the sidebar
// (navigation slice, 2026-10-14). Before, the account menu and the Admin menu
// each polled for their own.
//
//   - memberCount: the Members section's count (public: GET /members/summary);
//   - reviews / reviewsTo: what is NEW in the admins' review queues, and the
//     first queue with something new (admin menu slice, 2026-10-13);
//   - mySubmissions: your own submissions needing attention;
//   - editNotifs: projects you support that were edited since you looked.
//
// Each is best-effort: a failed read shows no count. Polled on navigation
// and every minute while the tab is open, as the menus did.

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useApi } from "../hooks/useApi";
import { useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import {
  adminQueueCounts,
  ADMIN_QUEUES_CHANGED,
  getEditNotifications,
  getMemberSummary,
  getReviewNotificationCount,
  markEditsSeen,
  type AdminQueueCounts,
  type EditNotification,
} from "../services/api";

/** The queues the review count adds up, in the order the icon opens them. */
const REVIEW_QUEUES = [
  { key: "reviews", to: "/admin/reviews" },
  { key: "briefs", to: "/admin/briefs" },
  { key: "meeting_summaries", to: "/admin/meeting-summaries" },
] as const;

export interface NavData {
  memberCount: number | null;
  /** New in the review queues; 0 for anyone not an admin. */
  reviews: number;
  /** The first queue with something new, so opening it clears what was counted. */
  reviewsTo: string;
  mySubmissions: number;
  editNotifs: EditNotification[];
  /** Clear the edited-projects badge, then open one of them. */
  openEdited: (href: string, navigate: (to: string) => void) => void;
}

const EMPTY: NavData = {
  memberCount: null,
  reviews: 0,
  reviewsTo: "/admin/reviews",
  mySubmissions: 0,
  editNotifs: [],
  openEdited: (href, navigate) => navigate(href),
};

const NO_EDITS: EditNotification[] = [];

const NavDataContext = createContext<NavData>(EMPTY);

export function NavDataProvider({ children }: { children: ReactNode }) {
  const { user, isAdmin } = useAuth();
  const { pathname } = useLocation();

  // The member count changes rarely: on sign-in (joining adds one) and load.
  // A failed read shows no count, like every read here.
  const { data: members } = useApi("members/summary", () => getMemberSummary(), { rereadOn: user?.id });
  const memberCount = members?.count ?? null;

  // Yours: submissions needing attention (cleared by opening My submissions,
  // which stamps reviews_seen_at), and edited projects you support. Read
  // again on every navigation, with the numbers shown meanwhile, and every
  // minute.
  const yoursChanged = useMemo(() => ({ user, pathname }), [user, pathname]);
  const { data: reviewCount, reload: reloadReviewCount } = useApi(
    user ? "/notifications/reviews/count?scope=mine" : null,
    () => getReviewNotificationCount(),
    { cache: true, rereadOn: yoursChanged },
  );
  const {
    data: editData,
    reload: reloadEdits,
    setData: setEditData,
  } = useApi(user ? "/notifications/edits" : null, () => getEditNotifications(), {
    cache: true,
    rereadOn: yoursChanged,
  });
  const mySubmissions = reviewCount?.count ?? 0;
  const editNotifs = editData?.items ?? NO_EDITS;
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      void reloadReviewCount();
      void reloadEdits();
    }, 60_000);
    return () => clearInterval(interval);
  }, [user, reloadReviewCount, reloadEdits]);

  // The admins' review queues: on navigation, when a page announces a change,
  // and every minute.
  const { data: counts, reload: reloadCounts } = useApi<AdminQueueCounts>(
    isAdmin ? "admin/queue-counts" : null,
    () => adminQueueCounts(),
    { rereadOn: pathname },
  );
  useEffect(() => {
    if (!isAdmin) return;
    const refetch = () => void reloadCounts();
    const interval = setInterval(refetch, 60_000);
    window.addEventListener(ADMIN_QUEUES_CHANGED, refetch);
    return () => {
      clearInterval(interval);
      window.removeEventListener(ADMIN_QUEUES_CHANGED, refetch);
    };
  }, [isAdmin, reloadCounts]);

  const reviews = counts ? REVIEW_QUEUES.reduce((n, q) => n + counts[q.key], 0) : 0;
  const reviewsTo = REVIEW_QUEUES.find((q) => (counts?.[q.key] ?? 0) > 0)?.to ?? "/admin/reviews";

  const value: NavData = {
    memberCount,
    reviews,
    reviewsTo,
    mySubmissions,
    editNotifs,
    openEdited: (href, navigate) => {
      // Opening any of them clears the badge; the page carries the history.
      // Stamp BEFORE navigating: the route change re-polls, and a poll that
      // raced the stamp would bring the dot straight back.
      setEditData({ count: 0, items: [] });
      markEditsSeen()
        .catch(() => {})
        .finally(() => navigate(href));
    },
  };
  return <NavDataContext.Provider value={value}>{children}</NavDataContext.Provider>;
}

export function useNavData(): NavData {
  return useContext(NavDataContext);
}
