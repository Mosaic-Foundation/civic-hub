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

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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

const NavDataContext = createContext<NavData>(EMPTY);

export function NavDataProvider({ children }: { children: ReactNode }) {
  const { user, isAdmin } = useAuth();
  const { pathname } = useLocation();
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [counts, setCounts] = useState<AdminQueueCounts | null>(null);
  const [mySubmissions, setMySubmissions] = useState(0);
  const [editNotifs, setEditNotifs] = useState<EditNotification[]>([]);

  // The member count changes rarely: on sign-in (joining adds one) and load.
  useEffect(() => {
    let live = true;
    getMemberSummary()
      .then((s) => live && setMemberCount(s.count))
      .catch(() => {
        /* a nicety: no count */
      });
    return () => {
      live = false;
    };
  }, [user?.id]);

  // Yours: submissions needing attention (cleared by opening My submissions,
  // which stamps reviews_seen_at), and edited projects you support.
  useEffect(() => {
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets this fetch's state when its input changes
      setMySubmissions(0);
      setEditNotifs([]);
      return;
    }
    let live = true;
    const fetchYours = () => {
      getReviewNotificationCount()
        .then((r) => live && setMySubmissions(r.count))
        .catch(() => {});
      getEditNotifications()
        .then((r) => live && setEditNotifs(r.items))
        .catch(() => {});
    };
    fetchYours();
    const interval = setInterval(fetchYours, 60_000);
    return () => {
      live = false;
      clearInterval(interval);
    };
  }, [user, pathname]);

  // The admins' review queues.
  useEffect(() => {
    if (!isAdmin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets this fetch's state when its input changes
      setCounts(null);
      return;
    }
    let live = true;
    const refetch = () => {
      adminQueueCounts()
        .then((c) => live && setCounts(c))
        .catch(() => {});
    };
    refetch();
    const interval = setInterval(refetch, 60_000);
    window.addEventListener(ADMIN_QUEUES_CHANGED, refetch);
    return () => {
      live = false;
      clearInterval(interval);
      window.removeEventListener(ADMIN_QUEUES_CHANGED, refetch);
    };
  }, [isAdmin, pathname]);

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
      setEditNotifs([]);
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
