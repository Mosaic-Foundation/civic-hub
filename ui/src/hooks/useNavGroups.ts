// What the hub's navigation lists, in one place, for the More sheet and the
// sidebar alike (navigation slice, 2026-10-14):
//
//   sections  Feed, then the enabled types' sections and Members, in the
//             hub's Section order (config/navigation.ts);
//   hub       Share this hub (members), Feedback, Welcome (when written), About;
//   admin     Reviews (with what is new), Moderation, Hub settings, Plugins,
//             Contact Civic.Social: admins only;
//   you       My submissions, edited projects you support, Your settings,
//             Post announcement (authors), Sign out: the signed-in person.
//
// Each item says whether it is the current page, so every layout marks it
// with aria-current="page".

import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useNavData } from "../context/NavDataContext";
import { navSections } from "../config/navigation";
import { pluginEnabled } from "../config/plugins";
import hub from "../config/hub";
import { sectionForPath } from "../../../src/shared/navSections";

export interface NavItem {
  id: string;
  label: string;
  /** A key in navIcons.tsx. */
  icon: string;
  /** A link; otherwise `onSelect` runs. */
  to?: string;
  onSelect?: () => void;
  /** A count beside it (Members, Reviews, My submissions); hidden at 0. */
  count?: number;
  /** What the count means, for a screen reader: "3 new". */
  countLabel?: string;
  current?: boolean;
  /** A second, smaller line (an edited project's "2 edits · see what changed"). */
  sub?: string;
  tone?: "danger";
  /** The phone's bar label, for sections. */
  short?: string;
}

export interface NavGroups {
  sections: NavItem[];
  hub: NavItem[];
  admin: NavItem[] | null;
  you: NavItem[] | null;
  /** "Signed in as <name>"; null when signed out. */
  userName: string | null;
}

const ADMIN_PAGES: ReadonlyArray<{ id: string; label: string; icon: string; to: string; match: (p: string) => boolean }> = [
  {
    id: "moderation",
    label: "Moderation",
    icon: "moderation",
    to: "/admin/moderation",
    match: (p) => p.startsWith("/admin/moderation"),
  },
  {
    id: "hub-settings",
    label: "Hub settings",
    icon: "settings",
    to: "/admin/settings",
    match: (p) => p.startsWith("/admin/settings") && !p.startsWith("/admin/settings/plugins"),
  },
  {
    id: "plugins",
    label: "Plugins",
    icon: "plugins",
    to: "/admin/settings/plugins",
    match: (p) => p.startsWith("/admin/settings/plugins"),
  },
  {
    id: "contact",
    label: "Contact Civic.Social",
    icon: "contact",
    to: "/admin/contact-civic-social",
    match: (p) => p.startsWith("/admin/contact-civic-social"),
  },
];

/** The queues the Reviews item covers: the same three its count adds up. */
const REVIEW_PATHS = ["/admin/reviews", "/admin/briefs", "/admin/meeting-summaries"];

export function useNavGroups({ onShare }: { onShare: () => void }): NavGroups {
  const { user, isAdmin, canPostAnnouncements, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const data = useNavData();

  const ordered = navSections();
  const currentSection = sectionForPath(pathname, ordered);
  const sections: NavItem[] = ordered.map((s) => ({
    id: s.id,
    label: s.label,
    short: s.short,
    icon: s.icon,
    to: s.path,
    current: s.id === currentSection,
    ...(s.id === "members" && data.memberCount ? { count: data.memberCount, countLabel: `${data.memberCount} members` } : {}),
  }));

  const hubLinks: NavItem[] = [];
  if (user?.is_resident) hubLinks.push({ id: "share", label: "Share this hub", icon: "share", onSelect: onShare });
  if (pluginEnabled("feedback")) {
    hubLinks.push({ id: "feedback", label: "Feedback", icon: "feedback", to: "/feedback", current: pathname === "/feedback" });
  }
  // Only when the hub has written one (review R27).
  if (hub.has_welcome) {
    hubLinks.push({ id: "welcome", label: "Welcome", icon: "welcome", to: "/welcome", current: pathname === "/welcome" });
  }
  hubLinks.push({ id: "about", label: "About", icon: "about", to: "/about", current: pathname === "/about" });

  const admin: NavItem[] | null = isAdmin
    ? [
        {
          id: "reviews",
          label: "Reviews",
          icon: "reviews",
          to: data.reviewsTo,
          count: data.reviews,
          countLabel: `${data.reviews} new`,
          current: REVIEW_PATHS.some((p) => pathname.startsWith(p)),
        },
        ...ADMIN_PAGES.map(({ match, ...page }) => ({ ...page, current: match(pathname) })),
      ]
    : null;

  const you: NavItem[] | null = user
    ? [
        {
          id: "my-submissions",
          label: "My submissions",
          icon: "submissions",
          to: "/my-submissions",
          count: data.mySubmissions,
          countLabel: `${data.mySubmissions} need your attention`,
          current: pathname.startsWith("/my-submissions"),
        },
        ...data.editNotifs.map((n) => ({
          id: `edited-${n.process_id}`,
          label: n.title,
          icon: "project",
          sub: `${n.edits === 1 ? "1 edit" : `${n.edits} edits`} · see what changed`,
          onSelect: () => data.openEdited(n.href, navigate),
        })),
        {
          id: "your-settings",
          label: "Your settings",
          icon: "your-settings",
          to: "/settings",
          current: pathname === "/settings",
        },
        ...(canPostAnnouncements && pluginEnabled("announcement")
          ? [{ id: "announce", label: "Post announcement", icon: "announce", to: "/announcement/new" }]
          : []),
        {
          id: "sign-out",
          label: "Sign out",
          icon: "sign-out",
          tone: "danger" as const,
          onSelect: () => {
            logout();
            navigate("/");
          },
        },
      ]
    : null;

  const userName = user ? (user.full_name?.trim() || user.display_name?.trim() || user.email) : null;
  return { sections, hub: hubLinks, admin, you, userName };
}
