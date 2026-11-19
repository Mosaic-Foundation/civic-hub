// An announcement's feed card, built from its event's payload (moved out of
// the kernel's classifier, kernel step 3, Nov 19). Plain data and functions:
// the feed, the digest and the server all read it through the manifest.

import type { Activity } from "@civic-social/plugin-sdk/manifest";

/** Width-saver for a pill: "Floyd County Government" -> "Floyd County Gov". */
function abbreviateGovernment(label: string): string {
  return label.replace(/\bGovernment\b/gi, "Gov");
}

/**
 * An announcement's card: its pill is its author's role, and an elected
 * official's or committee's post gets its own colour, so residents can tell
 * it from the hub administrator's.
 *
 * Posts News Sync copied in before it became its own plugin (2026-11-18) were
 * announcements with a `source` (keyed on its presence, not its origin string,
 * which changed when the module was renamed). Their processes are News items
 * now (migration 20261118180000), and their stored events read as News cards.
 */
export function announcementCard(data: Record<string, unknown>, actionUrl: string): Activity {
  const ann = data.announcement as { author_role?: unknown; source?: unknown } | undefined;
  const rawRole = typeof ann?.author_role === "string" ? ann.author_role : null;
  // Legacy "board" -> "Board member"; lowercase "admin"/unset -> "Admin"; any
  // other free-form role ("Planning Committee", ...) is shown verbatim.
  const normalized = rawRole === "board" ? "Board member" : rawRole === "admin" || !rawRole ? "Admin" : rawRole;
  const source = ann?.source;
  if (source && typeof source === "object") {
    const label = (source as { label?: unknown }).label;
    const from = typeof label === "string" && label.trim() ? label.trim() : normalized;
    return { surface: "news", kind: "news", color: "news", pill: "News", from, href: actionUrl };
  }
  const isAdmin = normalized === "Admin";
  return {
    surface: "announcement",
    kind: isAdmin ? "announcement" : "announcement-author",
    color: isAdmin ? "announcement" : "announcement-author",
    pill: abbreviateGovernment(normalized),
    href: actionUrl,
  };
}
