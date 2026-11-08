// Coming up's rows (ADR-019; Adam, 2026-11-07): the calendar's events still to
// start and the open processes still to close (GET /api/aside), however far
// out, earliest first, three at most. (A fourteen-day window hid the card on a
// hub whose next event was weeks away; Adam dropped it after dev.) A cancelled event is
// left out. A deadline of a type whose plugin is the calendar's is left out
// too: that process is an event, and the calendar already has it. Pure, so
// it is tested without a browser (comingUp.test.ts).

import type { AsideFacts, CalendarEventRow } from "../services/api";

/** Three, so Announcements stays in view below (Adam, 2026-11-07). */
export const COMING_UP_ROWS = 3;

export interface ComingUpRow {
  key: string;
  kind: "event" | "deadline";
  title: string;
  /** The instant the row is dated by: an event's start, a process's close. */
  at: string;
  /** The zone to show it in: the event's own, else the hub's (null: the reader's). */
  timeZone: string | null;
  /** A process's type, for its words ("Vote closes"). */
  type?: string;
  url: string;
  sample?: true;
}

export function comingUpRows(input: {
  facts: AsideFacts | null;
  events: CalendarEventRow[] | null;
  /** Types the calendar covers (the calendar plugin's), whose deadlines are left out. */
  calendarTypes: readonly string[];
  /** A calendar event's page. */
  eventPath: (processId: string) => string;
  hubTimeZone: string | null;
  now: number;
}): ComingUpRow[] {
  const within = (iso: string) => Date.parse(iso) > input.now;
  const events: ComingUpRow[] = (input.events ?? [])
    .filter((e) => !e.cancelled && within(e.start_time))
    .map((e) => ({
      key: `event:${e.process_id}`,
      kind: "event",
      title: e.title,
      at: e.start_time,
      timeZone: e.time_zone ?? input.hubTimeZone,
      url: input.eventPath(e.process_id),
    }));
  const deadlines: ComingUpRow[] = (input.facts?.deadlines ?? [])
    .filter((d) => !input.calendarTypes.includes(d.type) && within(d.closes_at))
    .map((d) => ({
      key: `deadline:${d.process_id}`,
      kind: "deadline",
      title: d.title,
      at: d.closes_at,
      timeZone: input.hubTimeZone,
      type: d.type,
      url: d.url,
      ...(d.sample ? { sample: true as const } : {}),
    }));
  return [...events, ...deadlines]
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
