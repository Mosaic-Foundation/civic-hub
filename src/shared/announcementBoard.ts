// Pinned and urgent announcements (Adam, 2026-11-15): the rules the
// announcement package, the right column's facts (src/services/aside.ts) and
// the UI share. Plain data and pure functions, so each side reads the same
// answer to "is this pinned / urgent right now".
//
//   Pinned   admins only, from Admin → Announcements, the announcement's page
//            or its form. Stays up until unpinned or its optional end date.
//            At most PINNED_MAX at once; the right column's card shows
//            BOARD_SHOWN and scrolls for the rest.
//   Urgent   anyone who may post or edit the announcement ticks it on the
//            form. A red Urgent label on the card, the page and the feed, and
//            a line across the top of the hub's pages. It needs an end date,
//            URGENT_DEFAULT_DAYS ahead unless the author picks another, at
//            most URGENT_MAX_DAYS.
//
// Both stay on the hub: neither is sent to the Fediverse or other hubs, and
// pinning does not move an announcement in the feed. An end date is read when
// the facts are read, so nothing has to run for an item to drop off.

/** How many announcements may be pinned at once. */
export const PINNED_MAX = 10;
/** How many rows the right column's card shows before it scrolls. */
export const BOARD_SHOWN = 3;
/** An urgent label's end date, unless the author picks another. */
export const URGENT_DEFAULT_DAYS = 7;
/** The furthest an urgent label's end date may be. */
export const URGENT_MAX_DAYS = 30;

/** The marks an announcement's state carries (all optional: older rows have none). */
export interface BoardMarks {
  pinned?: boolean | null;
  pinned_at?: string | null;
  pinned_until?: string | null;
  urgent?: boolean | null;
  urgent_until?: string | null;
}

function before(until: string | null | undefined, now: number): boolean {
  if (!until) return true;
  const t = Date.parse(until);
  return Number.isNaN(t) ? true : now < t;
}

/** Pinned, and its end date (if any) not yet passed. */
export function isPinnedNow(m: BoardMarks, now: number = Date.now()): boolean {
  return m.pinned === true && before(m.pinned_until, now);
}

/** Marked urgent, and its end date not yet passed. */
export function isUrgentNow(m: BoardMarks, now: number = Date.now()): boolean {
  return m.urgent === true && before(m.urgent_until, now);
}

/**
 * Why an end date is refused, or null when it is fine. `required` for
 * urgent; `maxDays` caps how far ahead it may be.
 */
export function endDateProblem(
  until: string | null | undefined,
  opts: { required: boolean; maxDays?: number; now?: number },
): string | null {
  const now = opts.now ?? Date.now();
  if (!until) return opts.required ? "Choose the date the urgent label ends." : null;
  const t = Date.parse(until);
  if (Number.isNaN(t)) return "The end date is not a date.";
  if (t <= now) return "The end date has already passed.";
  // A day's slack: the form sends the end of the chosen day in the hub's time zone.
  if (opts.maxDays !== undefined && t > now + (opts.maxDays + 1) * 86_400_000) {
    return `The end date can be at most ${opts.maxDays} days away.`;
  }
  return null;
}
