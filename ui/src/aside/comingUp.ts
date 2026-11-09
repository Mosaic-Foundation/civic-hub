// Coming up's rows (ADR-019): the calendar's events still to start, however
// far out, earliest first, three at most. A cancelled event is left out.
// Events only (Events 4, Adam, 2026-11-09): a vote, proposal or conversation
// about to close is a "closing soon" card in the feed now (Feed.tsx,
// closingSoon.ts). Pure, so it is tested without a browser (comingUp.test.ts).

import type { CalendarEventRow } from "../services/api";

/** Three, so Announcements stays in view below (Adam, 2026-11-07). */
export const COMING_UP_ROWS = 3;

export interface ComingUpRow {
  key: string;
  title: string;
  /** The event's start. */
  at: string;
  /** The zone to show it in: the hub's (null: the reader's). */
  timeZone: string | null;
  url: string;
}

export function comingUpRows(input: {
  events: CalendarEventRow[] | null;
  /** A calendar event's page. */
  eventPath: (processId: string) => string;
  hubTimeZone: string | null;
  now: number;
}): ComingUpRow[] {
  return (input.events ?? [])
    .filter((e) => !e.cancelled && Date.parse(e.start_time) > input.now)
    .map((e) => ({
      key: `event:${e.process_id}`,
      title: e.title,
      at: e.start_time,
      // Every time in the hub's zone (Events 3), whatever zone it was entered in.
      timeZone: input.hubTimeZone,
      url: input.eventPath(e.process_id),
    }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.key.localeCompare(b.key))
    .slice(0, COMING_UP_ROWS);
}

/** The zone as an option, or none when it is unset or not one the browser knows. */
function zone(timeZone: string | null): { timeZone?: string } {
  if (!timeZone) return {};
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return { timeZone };
  } catch {
    return {};
  }
}

/** "Nov" and "21": the row's date tile, in its zone. */
export function dateTile(iso: string, timeZone: string | null): { month: string; day: string } {
  const opts = zone(timeZone);
  const d = new Date(iso);
  return {
    month: d.toLocaleDateString("en-US", { month: "short", ...opts }),
    day: d.toLocaleDateString("en-US", { day: "numeric", ...opts }),
  };
}

/** "2:30 PM", in the row's zone. */
export function timeOfDay(iso: string, timeZone: string | null): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...zone(timeZone) });
}
