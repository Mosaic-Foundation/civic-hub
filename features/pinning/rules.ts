// The Pinning plugin's rules (Adam, 2026-11-15; any item 2026-11-18; a plugin
// of its own since kernel step 4, 2026-11-19): plain data and pure functions
// the server (./service.ts) and the UI (./ui/) share, so each side reads the
// same answer to "is this pinned right now".
//
//   Pinned   any item, from its page or Admin → Pinned, by whoever the
//            space's setting allows (plugin.pinning.who: admins, the
//            default, or every member). Stays up until unpinned or its
//            optional end date. At most PINNED_MAX at once; the card shows
//            BOARD_SHOWN and scrolls for the rest.
//   Urgent   a flag on a pin (Adam, 2026-11-19): the item is listed first,
//            marked Urgent, and the newest urgent pin is the line across the
//            top of the space's pages. Whoever may pin may flag.
//
// It stays on the space: a pin is not sent to the Fediverse or other spaces,
// and does not move an item in the feed. An end date is read when the pins
// are read, so nothing has to run for an item to drop off.

/** How many items may be pinned at once. */
export const PINNED_MAX = 10;
/** How many rows the card shows before it scrolls. */
export const BOARD_SHOWN = 3;

/** Who may pin: the setting's key and its choices. */
export const WHO_CAN_PIN_KEY = "plugin.pinning.who";
export const WHO_CAN_PIN = ["admins", "members"] as const;
export type WhoCanPin = (typeof WHO_CAN_PIN)[number];

/** The stored setting, read: anything but "members" is admins only. */
export function whoCanPinOf(value: string | null | undefined): WhoCanPin {
  return value?.trim() === "members" ? "members" : "admins";
}

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
