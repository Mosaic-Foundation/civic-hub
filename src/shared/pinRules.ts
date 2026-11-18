// The Pinned card's rules (Adam, 2026-11-15; any item 2026-11-18; the hub's own
// since pinning phase 2): plain data and pure functions the hub's pins
// (src/services/pins.ts), the card's facts (src/services/aside.ts) and the UI
// share, so each side reads the same answer to "is this pinned right now".
//
//   Pinned   admins only, any item, from its page's admin row or Admin →
//            Pinned. Stays up until unpinned or its optional end date. At most
//            PINNED_MAX at once; the card shows BOARD_SHOWN and scrolls for the
//            rest. A plugin may put its own items above the pins
//            (PluginServer.pinnedCard: the Announcements plugin's urgent ones).
//
// It stays on the hub: a pin is not sent to the Fediverse or other hubs, and
// does not move an item in the feed. An end date is read when the facts are
// read, so nothing has to run for an item to drop off.

/** How many items may be pinned at once. */
export const PINNED_MAX = 10;
/** How many rows the card shows before it scrolls. */
export const BOARD_SHOWN = 3;

function before(until: string | null | undefined, now: number): boolean {
  if (!until) return true;
  const t = Date.parse(until);
  return Number.isNaN(t) ? true : now < t;
}

/** A pin whose end date (if any) has not passed. */
export function isPinActive(pin: { pinned_until?: string | null }, now: number = Date.now()): boolean {
  return before(pin.pinned_until, now);
}

/** Why a pin's end date is refused, or null when it is fine (it is optional). */
export function pinEndDateProblem(until: string | null | undefined, now: number = Date.now()): string | null {
  if (!until) return null;
  const t = Date.parse(until);
  if (Number.isNaN(t)) return "The end date is not a date.";
  if (t <= now) return "The end date has already passed.";
  return null;
}
