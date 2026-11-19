// The admin area's own navigation, one rail for every layout (pilot readiness
// 3, Adam 2026-11-06; it replaces the design pass's admin bar). Since Nov 7
// (ADR-018's amendment) three of its groups fold with a chevron:
//
//   Review        Processes, Briefs, Meeting summaries, Edits; a closed
//                 group's head carries the sum of their counts
//   Community     Moderation, then features' pages (Pinned, Feedback)
//   Activity      a plain item (a feature's page, when switched on)
//   Hub settings  its sections (src/shared/adminAnchors.ts)
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
import { adminQueueTabs } from "../components/packageContributions";
import { useHub } from "../config/hub";
import { FEATURE_UI } from "../features";
import { SETTINGS_NAV, SETUP_CHECKLIST_PATH } from "../../../src/shared/adminAnchors";
import type { NavItem } from "./useNavGroups";

const EMPTY: AdminQueueCounts = { reviews: 0, edits: 0, total: 0 };

/** Is this an admin page? Every admin route lives under /admin. */
export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export type AdminNavGroupId = "review" | "community" | "settings";

/** A group that folds under its heading. */
export interface AdminNavGroup {
  kind: "group";
  id: AdminNavGroupId;
  label: string;
  items: NavItem[];
  /** The sum of the items' counts, for a closed group's heading. */
  count: number;
  /** The page you're on is one of its items. */
  current: boolean;
}

/** A single item between the groups (Activity). */
export interface AdminNavSingle {
  kind: "item";
  item: NavItem;
}

export type AdminNavEntry = AdminNavGroup | AdminNavSingle;

export interface AdminNav {
  entries: AdminNavEntry[];
  /** Small type at the rail's foot. */
  foot: NavItem[];
}

/** Hub settings' first page, where its group's head would lead. */
export const HUB_SETTINGS_PATH = "/admin/settings";

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
  const group = (id: AdminNavGroupId, label: string, items: NavItem[], current?: boolean): AdminNavGroup => ({
    kind: "group",
    id,
    label,
    items,
    count: items.reduce((n, i) => n + (i.count ?? 0), 0),
    current: current ?? items.some((i) => i.current),
  });

  const review: NavItem[] = [item("processes", "Processes", "reviews", "/admin/reviews", counts.reviews)];
  // The packages' review queues (Briefs, Meeting summaries), while their
  // plugin is on (components/packageContributions.ts).
  for (const q of adminQueueTabs(hub)) {
    review.push(item(q.path.replace(/^\/admin\//, ""), q.label, q.icon, q.path, counts[q.queue] ?? 0));
  }
  review.push(item("edits", "Edits", "edits", "/admin/edits", counts.edits));

  const community: NavItem[] = [item("moderation", "Moderation", "moderation", "/admin/moderation")];
  // A feature's page that belongs in Community (Pinning's Pinned, Feedback;
  // ui/src/features.ts), with its queue's count when it has one.
  for (const u of FEATURE_UI) {
    if (u.adminTab?.group === "community" && hub.plugins.enabled(u.feature)) {
      const count = u.adminTab.queue ? (counts[u.adminTab.queue] ?? 0) : undefined;
      community.push(item(`admin-${u.feature}`, u.adminTab.label, u.adminTab.icon, u.adminTab.path, count));
    }
  }

  // Feature packages' pages (ui/src/features.ts): Activity.
  const singles: AdminNavSingle[] = [];
  for (const u of FEATURE_UI) {
    if (u.adminTab && !u.adminTab.group && hub.plugins.enabled(u.feature)) {
      singles.push({ kind: "item", item: item(u.feature, u.adminTab.label, u.adminTab.icon, u.adminTab.path) });
    }
  }

  // Hub settings' sections, the same list its page draws (adminAnchors.ts).
  const settings: NavItem[] = SETTINGS_NAV.map((s) => ({
    id: `settings-${s.id}`,
    label: s.label,
    icon: "settings",
    to: `${HUB_SETTINGS_PATH}/${s.id}`,
    current: pathname === `${HUB_SETTINGS_PATH}/${s.id}`,
  }));
  const inSettings = pathname === HUB_SETTINGS_PATH || pathname.startsWith(`${HUB_SETTINGS_PATH}/`);

  const foot: NavItem[] = [
    item("archived", "Archived", "archived", "/admin/archived"),
    // The checklist in Hub settings (pilot readiness 3); the guide on the docs site is linked from there.
    // Never marked current: Getting started, under Hub settings, is.
    { ...item("setup-guide", "Setup guide", "guide", SETUP_CHECKLIST_PATH), current: false },
    item("contact", "Contact Civic.Social", "contact", "/admin/contact-civic-social"),
  ];
  return {
    entries: [
      group("review", "Review", review),
      group("community", "Community", community),
      ...singles,
      group("settings", "Hub settings", settings, inSettings),
    ],
    foot,
  };
}
