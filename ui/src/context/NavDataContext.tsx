// The numbers the hub's navigation shows, read once for every place that
// draws it: the header, the phone's bar and More sheet, and the sidebar
// (navigation slice, 2026-10-14). Before, the account menu and the Admin menu
// each polled for their own.
//
//   - sectionCounts: the number beside a feature's section (the Members
//     plugin's count; ui/src/features.ts);
//   - reviews / reviewsTo: what is NEW in the admins' review queues, and the
//     first queue with something new (admin menu slice, 2026-10-13);
//   - mySubmissions: your own submissions needing attention;
//   - editNotifs: projects you support that were edited since you looked.
//
// Each is best-effort: a failed read shows no count. Polled on navigation
// and every minute while the tab is open, as the menus did.

import { useEffect, useMemo, type ReactNode } from "react";
import { useApi } from "../hooks/useApi";
import { useLocation } from "react-router-dom";
import { useAuth } from "./authState";
import { useHub } from "../config/hub";
import { adminQueueTabs } from "../components/packageContributions";
import { featureSectionCounters } from "../features";
import { NavDataContext, type NavData } from "./navDataState";
import {
  adminQueueCounts,
  ADMIN_QUEUES_CHANGED,
  getEditNotifications,
  getReviewNotificationCount,
  markEditsSeen,
  type AdminQueueCounts,
  type EditNotification,
} from "../services/api";


const NO_EDITS: EditNotification[] = [];
const NO_COUNTS: Readonly<Record<string, number>> = {};

export function NavDataProvider({ children }: { children: ReactNode }) {
  const { user, isAdmin } = useAuth();
  const { pathname } = useLocation();
  const hub = useHub();

  // A section's count changes rarely (Members: joining adds one), so it is
  // read on load and sign-in. A failed read shows no count, like every read here.
  const counters = featureSectionCounters(hub.plugins.enabled);
  const countersKey = counters.map((c) => c.section).join(",");
  const { data: sectionCounts } = useApi(
    countersKey ? `section-counts:${countersKey}` : null,
    async () => {
      const read = await Promise.all(counters.map(async (c) => [c.section, await c.read().catch(() => null)] as const));
      return Object.fromEntries(read.filter((e): e is readonly [string, number] => typeof e[1] === "number"));
    },
    { rereadOn: user?.id },
  );

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

  // The queues the review count adds up, in the order the icon opens them:
  // the kernel's reviews, then each package's queue (while its plugin is on).
  const reviewQueues = [{ key: "reviews", to: "/admin/reviews" }, ...adminQueueTabs(hub).map((q) => ({ key: q.queue, to: q.path }))];
  const reviews = counts ? reviewQueues.reduce((n, q) => n + (counts[q.key] ?? 0), 0) : 0;
  const reviewsTo = reviewQueues.find((q) => (counts?.[q.key] ?? 0) > 0)?.to ?? "/admin/reviews";

  const value: NavData = {
    sectionCounts: sectionCounts ?? NO_COUNTS,
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
