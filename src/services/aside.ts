// The right column's facts (layout session, 2026-11-07; ADR-019): what
// GET /api/aside serves the three-column layout's cards. A read of what the
// hub already shows, nothing new:
//
//   - Coming up is the calendar's events only (Events 4, Adam, 2026-11-09),
//     read from GET /calendar/events; it has nothing here. Closing dates moved
//     to the feed, as "closing soon" cards (services/closingSoon.ts).
//   - announcements: the Pinned card (Adam, 2026-11-15; the hub's own since
//     pinning phase 2, src/shared/pinRules.ts). First the rows plugins put at
//     its top (PluginServer.pinnedCard: the Announcements plugin's urgent
//     announcements), then every item pinned right now (process_pins), of any
//     type whose plugin is on, the newest first. When none is, the rows a
//     plugin offers to fill the card (the newest few announcements).
//   - urgent: the first row a plugin flags urgent, for the line across the
//     top of the hub's pages, or null.
//   - about: the member count, when the Members plugin is on and its count is
//     public (the same rule as GET /members/summary). The place and the About
//     link are the hub's config, which the page already has.
//
// The same for every reader but an admin, to whom a plugin filling the card
// may show what the feed shows an admin. No account, name or ballot is in it.

import { getManifest } from "../processes/registry.js";
import { memberVisibility } from "./members.js";
import { isPluginEnabledSync } from "./hubSettings.js";
import { contributedFill, contributedFirst, pinnedItemLabel } from "./pinnedCard.js";
import { readVisiblePins } from "./pins.js";
import type { PinnedCardItem } from "../plugins/pinnedCard.js";

/** Announcements in their card. */
export const ASIDE_ANNOUNCEMENTS = 3;

export interface AsideAnnouncement {
  process_id: string;
  title: string;
  published_at: string;
  url: string;
  /** Its type's one-word label ("Vote"), on a pinned item. */
  type_label?: string;
  sample?: true;
  /** On the board: pinned right now. */
  pinned?: true;
  /** On the board: a plugin's urgent row, its end date not passed. */
  urgent?: true;
}

export interface AsideFacts {
  /** The card's name: "Pinned", or the filling plugin's type ("Announcements"). */
  card_title: string;
  announcements: AsideAnnouncement[];
  /** The first urgent row, for the line across the top of the pages. */
  urgent: AsideAnnouncement | null;
  about: { member_count: number | null };
}

export async function readAside(opts: { isAdmin: boolean }): Promise<AsideFacts> {
  const [board, memberCount] = await Promise.all([readBoard(), readMemberCount()]);
  const fill = board.length > 0 ? null : await contributedFill(opts.isAdmin);
  return {
    card_title: fill ? getManifest(fill.type)?.descriptor.display.plural ?? "Pinned" : "Pinned",
    announcements: fill ? fill.items.slice(0, ASIDE_ANNOUNCEMENTS).map(cardRow) : board,
    urgent: board.find((a) => a.urgent) ?? null,
    about: { member_count: memberCount },
  };
}

function cardRow(item: PinnedCardItem): AsideAnnouncement {
  return {
    process_id: item.process_id,
    title: item.title,
    published_at: item.published_at,
    url: item.url,
    ...(item.sample ? { sample: true as const } : {}),
    ...(item.urgent ? { urgent: true as const } : {}),
  };
}

/** The plugins' rows (urgent first), then the items pinned right now, the newest first. */
async function readBoard(): Promise<AsideAnnouncement[]> {
  const now = Date.now();
  // With the hub's Pinning switch off, a pin shows nowhere; a plugin's rows stay.
  const [first, pinned] = await Promise.all([contributedFirst(), isPluginEnabledSync("pinning") ? readVisiblePins(now) : []]);
  const top = first.map(cardRow).sort((a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)) || b.published_at.localeCompare(a.published_at));
  // Only what Admin → Pinned lists: a switched-off plugin's items leave the card as they leave the feed.
  const pins = pinned
    .map((p): AsideAnnouncement => {
      const state = p.state as { content?: { title?: string }; created_at?: string };
      const manifest = getManifest(p.type);
      const label = pinnedItemLabel(p.type, { process_id: p.process_id, state: p.state }) ?? manifest?.descriptor.display.label;
      return {
        process_id: p.process_id,
        title: state.content?.title || p.title,
        published_at: state.created_at ?? p.created_at,
        url: manifest?.detailPath(p.process_id) ?? `/process/${p.process_id}`,
        ...(label ? { type_label: label } : {}),
        ...(p.is_sample && !p.added_in_demo ? { sample: true as const } : {}),
        pinned: true as const,
      };
    })
    .sort((a, b) => b.published_at.localeCompare(a.published_at));
  // An item both on a plugin's rows and pinned shows once, at the top, marked pinned too.
  const pinnedIds = new Set(pins.map((p) => p.process_id));
  const topIds = new Set(top.map((t) => t.process_id));
  return [
    ...top.map((t) => (pinnedIds.has(t.process_id) ? { ...t, pinned: true as const } : t)),
    ...pins.filter((p) => !topIds.has(p.process_id)),
  ];
}

async function readMemberCount(): Promise<number | null> {
  if (!isPluginEnabledSync("members")) return null;
  const seen = await memberVisibility();
  return seen.countShown ? seen.count : null;
}
