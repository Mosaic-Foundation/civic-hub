// End dates for pins (features/pinning/rules.ts):
// the forms pick a day, read in the hub's time zone; the item stays up to the
// end of that day.

import { dayKey } from "../kit/dates";
import { fromLocalInput } from "../kit/datetime";

/** "YYYY-MM-DD", `days` from today in the hub's time zone. */
export function dayFromToday(days: number, timeZone: string, now: number = Date.now()): string {
  return dayKey(new Date(now + days * 86_400_000), timeZone);
}

/** The end of that day in the hub's time zone, as an ISO instant ("" → null). */
export function endOfDay(day: string, timeZone: string): string | null {
  return day ? fromLocalInput(`${day}T23:59`, timeZone) : null;
}

/** The day an end date falls on in the hub's time zone ("" for none). */
export function dayOf(iso: string | null | undefined, timeZone: string): string {
  return iso ? dayKey(iso, timeZone) : "";
}

/** "Nov 20": a short date for "until Nov 20". */
export function shortDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(new Date(iso));
}
