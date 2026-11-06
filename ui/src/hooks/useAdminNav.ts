// The admin area's own navigation, one rail for every layout (pilot readiness
// 3, Adam 2026-11-06; it replaces the design pass's admin bar). Grouped, so it
// fits the window without scrolling:
//
//   Review     Processes, Briefs, Meeting summaries, Edits; the group's head
//              carries the sum of their counts
//   Community  Moderation, Feedback
//   Activity   (a feature's page, when switched on)
//   Hub settings, whose sections open under it only while you're in it
//   and at the foot, in small type: Archived, Setup guide, Contact Civic.Social.
//
// The desktop rail (Sidebar.tsx) and the phone's drawer (AdminDrawer.tsx)
// draw the same groups.
//
// Counts (Adam, 2026-09-06): each item shows what is NEW in its queue since
// this admin last opened it — "new is defined by items that I haven't
// viewed". Opening the item stamps its cursor and the count clears.
// Moderation is a log: no count. Read again on every navigation and when a
// page announces a change.

import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useApi } from "./useApi";
import { adminQueueCounts, ADMIN_QUEUES_CHANGED, type AdminQueueCounts } from "../services/api";
import { useHub } from "../config/hub";
import { FEATURE_UI } from "../features";
import { SETUP_CHECKLIST_PATH } from "../../../src/shared/adminAnchors";
import type { NavItem } from "./useNavGroups";

const EMPTY: AdminQueueCounts = { reviews: 0, briefs: 0, meeting_summaries: 0, feedback: 0, edits: 0, total: 0 };

/** Is this an admin page? Every admin route lives under /admin. */
export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export interface AdminNavGroup {
  id: "review" | "community" | "main";
  /** The group's small heading; none for the single items. */
  label?: string;
  items: NavItem[];
  /** The sum of the items' counts, for the heading. */
  count: number;
}

export interface AdminNav {
  groups: AdminNavGroup[];
  /** Small type at the rail's foot. */
  foot: NavItem[];
}

export function useAdminNav(): AdminNav {
  const hub = useHub();
  const { pathname } = useLocation();
  // A failed read shows no counts (best-effort); each navigation reads again,
  // keeping the counts shown meanwhile.
  const { data, reload } = useApi<AdminQueueCounts>("admin/queue-counts", () => adminQueueCounts(), {
    rereadOn: pathname,
  });
  const counts = data ?? EMPTY;
  useEffect(() => {
    const refetch = () => void reload();
    window.addEventListener(ADMIN_QUEUES_CHANGED, refetch);
    return () => window.removeEventListener(ADMIN_QUEUES_CHANGED, refetch);
  }, [reload]);

  const item = (id: string, label: string, icon: string, to: string, count?: number): NavItem => ({
    id,
    label,
    icon,
    to,
    current: pathname.startsWith(to),
    ...(count !== undefined ? { count, countLabel: `${count} new since you last looked` } : {}),
  });
  const group = (id: AdminNavGroup["id"], items: NavItem[], label?: string): AdminNavGroup => ({
    id,
    ...(label ? { label } : {}),
    items,
    count: items.reduce((n, i) => n + (i.count ?? 0), 0),
  });

  const review: NavItem[] = [item("processes", "Processes", "reviews", "/admin/reviews", counts.reviews)];
  // Hidden when the hub switched the plugin off (config/plugins.tsx).
  if (hub.plugins.enabled("brief")) review.push(item("briefs", "Briefs", "outcome", "/admin/briefs", counts.briefs));
  if (hub.plugins.enabled("meeting_summary")) {
    review.push(item("meeting-summaries", "Meeting summaries", "meeting", "/admin/meeting-summaries", counts.meeting_summaries));
  }
  review.push(item("edits", "Edits", "edits", "/admin/edits", counts.edits));

  const community: NavItem[] = [item("moderation", "Moderation", "moderation", "/admin/moderation")];
  if (hub.plugins.enabled("feedback")) {
    community.push(item("admin-feedback", "Feedback", "feedback", "/admin/feedback", counts.feedback));
  }

  // Feature packages' pages (ui/src/features.ts): Activity.
  const main: NavItem[] = [];
  for (const u of FEATURE_UI) {
    if (u.adminTab && hub.plugins.enabled(u.feature)) main.push(item(u.feature, u.adminTab.label, u.adminTab.icon, u.adminTab.path));
  }
  main.push(item("hub-settings", "Hub settings", "settings", "/admin/settings"));

  const foot: NavItem[] = [
    item("archived", "Archived", "archived", "/admin/archived"),
    // The checklist in Hub settings (pilot readiness 3); the guide on the docs site is linked from there.
    { ...item("setup-guide", "Setup guide", "guide", SETUP_CHECKLIST_PATH), current: pathname.startsWith(SETUP_CHECKLIST_PATH) },
    item("contact", "Contact Civic.Social", "contact", "/admin/contact-civic-social"),
  ];
  return { groups: [group("review", review, "Review"), group("community", community, "Community"), group("main", main)], foot };
}
