// What is about to close (Events 4, Adam, 2026-11-09): the open processes whose
// deadline is within the hub's window (48 hours unless an admin sets another), for the feed's "Closes tomorrow at 5:00 PM" cards. Before,
// closing dates sat in the right column's Coming up card; now Coming up is the
// calendar's events only and the reminder is a card in the feed.
//
// A read of what the hub already shows, nothing new: each type's declared
// deadline (its descriptor's `deadline.source`, read as the process's own page
// reads `ends_at`), for every type with a deadline whose plugin is on; no list
// here names one. Not an event on the wire: the card is built in the feed view
// from the close time (GET /api/feed/closing), so /events is unchanged.
//
// Each row carries `since`, when it entered the window: the deadline less the
// window, or the process's start when it opened already inside it. The feed
// places the card by that time.
//
// The same for every reader: only open ("active") processes, so nothing under
// review, archived or closed; no account, name or ballot.

import { getManifest, getManifests } from "../processes/registry.js";
import { isProcessTypeEnabled } from "./pluginGate.js";
import { openProcessRows } from "./processRows.js";
import { readDeadline } from "./closeEarly.js";
import { getSettingSync } from "./hubSettings.js";
import { KEYS } from "../models/hubSettings.js";
import type { Process } from "../models/process.js";

/** How long before its close a process is "closing soon" when the hub sets nothing (Adam, 2026-11-09): 48 hours. */
export const CLOSING_SOON_DEFAULT_HOURS = 48;
export const CLOSING_SOON_MS = CLOSING_SOON_DEFAULT_HOURS * 60 * 60 * 1000;

/**
 * The hub's window, from `feed.closing_reminder_hours` (Settings → Appearance):
 * one value for every type; unset or unreadable is 48 hours, 0 is none.
 */
export function closingSoonWindowMs(stored: string | undefined): number {
  const hours = stored === undefined || stored.trim() === "" ? NaN : Number(stored);
  if (!Number.isInteger(hours) || hours < 0) return CLOSING_SOON_MS;
  return hours * 60 * 60 * 1000;
}
/** Open processes read for their deadlines, at most. */
const OPEN_READ_MAX = 500;

export interface ClosingSoon {
  process_id: string;
  type: string;
  title: string;
  closes_at: string;
  /** When it entered the window: the feed's time for the card. */
  since: string;
  url: string;
  sample?: true;
}

function detailUrl(type: string, id: string): string {
  return getManifest(type)?.detailPath(id) ?? `/process/${id}`;
}

/** The open processes closing within the window from `now`, earliest close first. */
export async function readClosingSoon(opts: { now?: number; windowMs?: number } = {}): Promise<ClosingSoon[]> {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? closingSoonWindowMs(getSettingSync(KEYS.FEED_CLOSING_REMINDER_HOURS));
  if (windowMs <= 0) return [];
  const withDeadline = getManifests().filter((m) => m.descriptor.deadline && isProcessTypeEnabled(m.descriptor.type));
  const rows = await openProcessRows(
    withDeadline.map((m) => m.descriptor.type),
    OPEN_READ_MAX,
  );
  const found = await Promise.all(
    rows.map(async (row) => {
      const source = getManifest(row.type)?.descriptor.deadline?.source;
      if (!source) return null;
      const due = await readDeadline(source, { id: row.id, state: row.state ?? {} } as Process);
      const at = due ? Date.parse(due) : NaN;
      if (!(at > now) || at - now > windowMs) return null;
      const opened = row.created_at ? Date.parse(row.created_at) : NaN;
      const since = Number.isFinite(opened) ? Math.max(at - windowMs, opened) : at - windowMs;
      const sample = row.is_sample && !row.added_in_demo;
      return {
        process_id: row.id,
        type: row.type,
        title: row.title,
        closes_at: new Date(at).toISOString(),
        since: new Date(Math.min(since, now)).toISOString(),
        url: detailUrl(row.type, row.id),
        ...(sample ? { sample: true as const } : {}),
      };
    }),
  );
  return found
    .filter((d): d is ClosingSoon => d !== null)
    .sort((a, b) => a.closes_at.localeCompare(b.closes_at) || a.process_id.localeCompare(b.process_id));
}
