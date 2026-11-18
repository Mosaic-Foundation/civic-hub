// Urgent announcements (Adam, 2026-11-15): Announcements' own rules. Pinning
// was here too until pinning phase 2 (2026-11-18) made it the hub's
// (src/shared/pinRules.ts on the kernel side); Urgent stays an Announcements
// feature, offered to the hub's Pinned card through ./pinnedCard.ts.
//
//   Urgent   anyone who may post or edit the announcement ticks it on the
//            form. A red Urgent label on the card, the page and the feed, and
//            a line across the top of the hub's pages. Listed first on the
//            Pinned card. It needs an end date, URGENT_DEFAULT_DAYS ahead
//            unless the author picks another, at most URGENT_MAX_DAYS.
//
// It stays on the hub: it is not sent to the Fediverse or other hubs. An end
// date is read when the facts are read, so nothing has to run for an item to
// drop off.

/** An urgent label's end date, unless the author picks another. */
export const URGENT_DEFAULT_DAYS = 7;
/** The furthest an urgent label's end date may be. */
export const URGENT_MAX_DAYS = 30;

/** The urgent marks an announcement's state carries (optional: older rows have none). */
export interface UrgentMarks {
  urgent?: boolean | null;
  urgent_until?: string | null;
}

/** Marked urgent, and its end date not yet passed. */
export function isUrgentNow(m: UrgentMarks, now: number = Date.now()): boolean {
  if (m.urgent !== true) return false;
  if (!m.urgent_until) return true;
  const t = Date.parse(m.urgent_until);
  return Number.isNaN(t) ? true : now < t;
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
