// The admin area's own navigation, one list for every layout (design pass,
// decision 4, 2026-10-29): the admin bar draws it under the hub header, and
// the left column draws it under an Admin heading. Ordered by function: the
// publication queues first (Processes, Briefs, Meeting summaries), then
// oversight (Moderation, Feedback, Edits, Archived), the switched-on
// features' pages (Activity), then Hub settings, and last the setup guide on
// the docs site, which opens in a new tab.
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
import { helpEntry, helpUrl } from "../../../src/shared/helpRegistry";
import type { NavItem } from "./useNavGroups";

const EMPTY: AdminQueueCounts = { reviews: 0, briefs: 0, meeting_summaries: 0, feedback: 0, edits: 0, total: 0 };

/** Is this an admin page? Every admin route lives under /admin. */
export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function useAdminNav(): NavItem[] {
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

  const items: NavItem[] = [item("processes", "Processes", "reviews", "/admin/reviews", counts.reviews)];
  // Hidden when the hub switched the plugin off (config/plugins.tsx).
  if (hub.plugins.enabled("brief")) items.push(item("briefs", "Briefs", "outcome", "/admin/briefs", counts.briefs));
  if (hub.plugins.enabled("meeting_summary")) {
    items.push(item("meeting-summaries", "Meeting summaries", "meeting", "/admin/meeting-summaries", counts.meeting_summaries));
  }
  items.push(item("moderation", "Moderation", "moderation", "/admin/moderation"));
  if (hub.plugins.enabled("feedback")) {
    items.push(item("admin-feedback", "Feedback", "feedback", "/admin/feedback", counts.feedback));
  }
  items.push(item("edits", "Edits", "edits", "/admin/edits", counts.edits));
  items.push(item("archived", "Archived", "archived", "/admin/archived"));
  // Feature packages' pages (ui/src/features.ts): Activity.
  for (const u of FEATURE_UI) {
    if (u.adminTab && hub.plugins.enabled(u.feature)) items.push(item(u.feature, u.adminTab.label, u.adminTab.icon, u.adminTab.path));
  }
  items.push(item("hub-settings", "Hub settings", "settings", "/admin/settings"));
  items.push({ id: "setup-guide", label: "Setup guide", icon: "guide", href: helpUrl(helpEntry("admin.setup_guide")!) });
  return items;
}
