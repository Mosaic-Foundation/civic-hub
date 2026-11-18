// The right column's facts (layout session, 2026-11-07; ADR-019): what
// GET /api/aside serves the three-column layout's cards. A read of what the
// hub already shows, nothing new:
//
//   - Coming up is the calendar's events only (Events 4, Adam, 2026-11-09),
//     read from GET /calendar/events; it has nothing here. Closing dates moved
//     to the feed, as "closing soon" cards (services/closingSoon.ts).
//   - announcements: the board (Adam, 2026-11-15; src/shared/
//     announcementBoard.ts): every item pinned right now, of any type whose
//     plugin is on (Adam, 2026-11-18), and every announcement marked urgent,
//     urgent first, then newest first. When none is, the newest few
//     announcement cards, as the feed's Announcements filter reads them
//     (services/feedPage.ts), a removed one left out as the feed leaves it out.
//   - urgent: the newest urgent announcement, for the line across the top of
//     the hub's pages, or null.
//   - about: the member count, when the Members plugin is on and its count is
//     public (the same rule as GET /members/summary). The place and the About
//     link are the hub's config, which the page already has.
//
// The same for every reader but an admin, who also sees restricted
// announcements, as on the feed. No account, name or ballot is in it.

import { getManifest } from "../processes/registry.js";
import { processTypesAndTitles } from "./processRows.js";
import { readFeedPage } from "./feedPage.js";
import { buildFeedProcessMeta } from "./feedMeta.js";
import { memberVisibility } from "./members.js";
import { isPluginEnabledSync } from "./hubSettings.js";
import { boardRows } from "./processRows.js";
import { isProcessTypeEnabled } from "./pluginGate.js";
import { isPinnedNow, isUrgentNow, type BoardMarks } from "../shared/announcementBoard.js";

/** Announcements in their card. */
export const ASIDE_ANNOUNCEMENTS = 3;

export interface AsideAnnouncement {
  process_id: string;
  title: string;
  published_at: string;
  url: string;
  /** Its type's one-word label ("Vote"), on a pinned item that is not an announcement. */
  type_label?: string;
  sample?: true;
  /** On the board: pinned right now. */
  pinned?: true;
  /** On the board: marked urgent, its end date not passed. */
  urgent?: true;
}

export interface AsideFacts {
  announcements: AsideAnnouncement[];
  /** The newest urgent announcement, for the line across the top of the pages. */
  urgent: AsideAnnouncement | null;
  about: { member_count: number | null };
}

export async function readAside(opts: { isAdmin: boolean }): Promise<AsideFacts> {
  const [board, memberCount] = await Promise.all([readBoard(), readMemberCount()]);
  const announcements = board.length > 0 ? board : await readAnnouncements(opts.isAdmin);
  return {
    announcements,
    urgent: board.find((a) => a.urgent) ?? null,
    about: { member_count: memberCount },
  };
}

/** Pinned items and urgent announcements, right now: urgent first, then newest first. */
async function readBoard(): Promise<AsideAnnouncement[]> {
  const now = Date.now();
  const rows = (await boardRows())
    // A switched-off plugin's items leave the card as they leave the feed.
    .filter((r) => isProcessTypeEnabled(r.type))
    .map((r) => ({ r, marks: r.state as BoardMarks & { moderation?: { removed?: boolean } | null; created_at?: string } }))
    .filter(({ marks }) => !marks.moderation?.removed)
    .map(({ r, marks }) => ({ r, marks, pinned: isPinnedNow(marks, now), urgent: isUrgentNow(marks, now) }))
    .filter((x) => x.pinned || x.urgent);
  const at = (x: (typeof rows)[number]) => x.marks.created_at ?? x.r.created_at;
  rows.sort((a, b) => Number(b.urgent) - Number(a.urgent) || at(b).localeCompare(at(a)));
  return rows.map(({ r, marks, pinned, urgent }) => {
    const content = (r.state as { content?: { title?: string } }).content;
    const label = r.type === ANNOUNCEMENT ? null : getManifest(r.type)?.descriptor.display.label ?? null;
    return {
      process_id: r.id,
      title: content?.title || r.title,
      published_at: marks.created_at ?? r.created_at,
      url: detailUrl(r.type, r.id),
      ...(label ? { type_label: label } : {}),
      ...(r.is_sample && !r.added_in_demo ? { sample: true as const } : {}),
      ...(pinned ? { pinned: true as const } : {}),
      ...(urgent ? { urgent: true as const } : {}),
    };
  });
}

/** The card's own type: its rows need no type label. */
const ANNOUNCEMENT = "civic.announcement";

function detailUrl(type: string, id: string): string {
  return getManifest(type)?.detailPath(id) ?? `/process/${id}`;
}

async function readAnnouncements(isAdmin: boolean): Promise<AsideAnnouncement[]> {
  // A few more than needed: a removed one is left out after the read.
  const page = await readFeedPage({ limit: ASIDE_ANNOUNCEMENTS * 2, cursor: null, surface: "announcement", isAdmin });
  const meta = await buildFeedProcessMeta(page.events);
  const events = page.events.filter((e) => e.process_id && !meta[e.process_id]?.removed);
  const facts = new Map((await processTypesAndTitles(events.map((e) => e.process_id))).map((r) => [r.id, r]));
  const out: AsideAnnouncement[] = [];
  for (const e of events) {
    const fact = facts.get(e.process_id);
    if (!fact || out.some((a) => a.process_id === e.process_id)) continue;
    out.push({
      process_id: e.process_id,
      title: meta[e.process_id]?.title || fact.title,
      published_at: e.timestamp,
      url: detailUrl(fact.type, e.process_id),
      ...(e.sample ? { sample: true as const } : {}),
    });
    if (out.length === ASIDE_ANNOUNCEMENTS) break;
  }
  return out;
}

async function readMemberCount(): Promise<number | null> {
  if (!isPluginEnabledSync("members")) return null;
  const seen = await memberVisibility();
  return seen.countShown ? seen.count : null;
}
