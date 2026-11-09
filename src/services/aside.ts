// The right column's facts (layout session, 2026-11-07; ADR-019): what
// GET /api/aside serves the three-column layout's cards. A read of what the
// hub already shows, nothing new:
//
//   - Coming up is the calendar's events only (Events 4, Adam, 2026-11-09),
//     read from GET /calendar/events; it has nothing here. Closing dates moved
//     to the feed, as "closing soon" cards (services/closingSoon.ts).
//   - announcements: the newest few announcement cards, as the feed's
//     Announcements filter reads them (services/feedPage.ts), a removed one
//     left out as the feed leaves it out.
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

/** Announcements in their card. */
export const ASIDE_ANNOUNCEMENTS = 3;

export interface AsideAnnouncement {
  process_id: string;
  title: string;
  published_at: string;
  url: string;
  sample?: true;
}

export interface AsideFacts {
  announcements: AsideAnnouncement[];
  about: { member_count: number | null };
}

export async function readAside(opts: { isAdmin: boolean }): Promise<AsideFacts> {
  const [announcements, memberCount] = await Promise.all([readAnnouncements(opts.isAdmin), readMemberCount()]);
  return { announcements, about: { member_count: memberCount } };
}

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
