// The right column's facts (layout session, 2026-11-07; ADR-019): what
// GET /api/aside serves the three-column layout's cards. A read of what the
// hub already shows, nothing new:
//
//   - deadlines: open processes that close within ASIDE_DEADLINE_DAYS, from
//     each type's declared deadline (its descriptor's `deadline.source`, read
//     as the process's own page reads `ends_at`), earliest first. Every type
//     with a deadline whose plugin is on; no list here names one. Events come
//     to Coming up from the calendar (GET /calendar/events), and the column
//     leaves out the rows it has from there (ui/src/aside/ComingUp.tsx).
//   - announcements: the newest few announcement cards, as the feed's
//     Announcements filter reads them (services/feedPage.ts), a removed one
//     left out as the feed leaves it out.
//   - about: the member count, when the Members plugin is on and its count is
//     public (the same rule as GET /members/summary). The place and the About
//     link are the hub's config, which the page already has.
//
// The same for every reader but an admin, who also sees restricted
// announcements, as on the feed. No account, name or ballot is in it.

import { getManifest, getManifests } from "../processes/registry.js";
import { isProcessTypeEnabled } from "./pluginGate.js";
import { openProcessRows, processTypesAndTitles } from "./processRows.js";
import { readDeadline } from "./closeEarly.js";
import { readFeedPage } from "./feedPage.js";
import { buildFeedProcessMeta } from "./feedMeta.js";
import { memberVisibility } from "./members.js";
import { isPluginEnabledSync } from "./hubSettings.js";
import type { Process } from "../models/process.js";

/** How far ahead Coming up looks (Adam, 2026-11-07). */
export const ASIDE_DEADLINE_DAYS = 14;
/** Rows in Coming up, events included (Adam, 2026-11-07). */
export const ASIDE_ROWS = 5;
/** Announcements in their card. */
export const ASIDE_ANNOUNCEMENTS = 3;
/** Open processes read for their deadlines, at most. */
const OPEN_READ_MAX = 500;

export interface AsideDeadline {
  process_id: string;
  type: string;
  title: string;
  closes_at: string;
  url: string;
  sample?: true;
}

export interface AsideAnnouncement {
  process_id: string;
  title: string;
  published_at: string;
  url: string;
  sample?: true;
}

export interface AsideFacts {
  deadlines: AsideDeadline[];
  announcements: AsideAnnouncement[];
  about: { member_count: number | null };
}

export async function readAside(opts: { isAdmin: boolean; now?: number }): Promise<AsideFacts> {
  const now = opts.now ?? Date.now();
  const [deadlines, announcements, memberCount] = await Promise.all([
    readDeadlines(now),
    readAnnouncements(opts.isAdmin),
    readMemberCount(),
  ]);
  return { deadlines, announcements, about: { member_count: memberCount } };
}

function detailUrl(type: string, id: string): string {
  return getManifest(type)?.detailPath(id) ?? `/process/${id}`;
}

async function readDeadlines(now: number): Promise<AsideDeadline[]> {
  const withDeadline = getManifests().filter((m) => m.descriptor.deadline && isProcessTypeEnabled(m.descriptor.type));
  const rows = await openProcessRows(
    withDeadline.map((m) => m.descriptor.type),
    OPEN_READ_MAX,
  );
  const until = now + ASIDE_DEADLINE_DAYS * 24 * 60 * 60 * 1000;
  const found = await Promise.all(
    rows.map(async (row) => {
      const source = getManifest(row.type)?.descriptor.deadline?.source;
      if (!source) return null;
      const due = await readDeadline(source, { id: row.id, state: row.state ?? {} } as Process);
      const at = due ? Date.parse(due) : NaN;
      if (!(at > now && at <= until)) return null;
      const sample = row.is_sample && !row.added_in_demo;
      return {
        process_id: row.id,
        type: row.type,
        title: row.title,
        closes_at: new Date(at).toISOString(),
        url: detailUrl(row.type, row.id),
        ...(sample ? { sample: true as const } : {}),
      };
    }),
  );
  return found
    .filter((d): d is AsideDeadline => d !== null)
    .sort((a, b) => a.closes_at.localeCompare(b.closes_at) || a.process_id.localeCompare(b.process_id))
    .slice(0, ASIDE_ROWS);
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
