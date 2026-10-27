// What an event is: its time and place, checked the same way wherever one
// comes in (a draft, an edit), and what its events carry about it. Plain
// code: the handler, the draft kind, the .ics route and the pages share it.

/** A street address, as schema.org's PostalAddress (Mobilizon's shape). */
export interface PostalAddress {
  type: "PostalAddress";
  streetAddress?: string;
  addressLocality?: string;
  addressRegion?: string;
  postalCode?: string;
  addressCountry?: string;
}

/** Where it is: a place (AS2 Place, with an optional address) or an online link (AS2 Link). */
export type EventLocation =
  | { type: "Place"; name: string; address?: PostalAddress }
  | { type: "Link"; name: string; href: string };

export interface EventState {
  /** When it starts and ends (ISO, UTC). */
  start_time: string;
  end_time: string;
  location: EventLocation;
  /** Set when it was cancelled; it stays on the calendar, marked. */
  cancelled: { at: string; reason: string } | null;
}

export const TITLE_MAX = 120;
export const VENUE_MAX = 120;
export const ADDRESS_FIELD_MAX = 120;
export const REASON_MAX = 500;
/** The longest an event may run. */
export const MAX_DURATION_MS = 14 * 86_400_000;
const SUMMARY_MAX = 280;

/** Why a value can't be used, worded for the person who entered it. */
export class EventInputError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "EventInputError";
    this.code = code;
  }
}

function text(value: unknown, max: number, label: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (s.length > max) throw new EventInputError(`${label} can be at most ${max} characters.`, "too_long");
  return s;
}

/** An instant from an ISO string with an offset; null when empty. */
export function instant(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value.trim())) {
    throw new EventInputError(`${label} needs a date and time.`, "time_invalid");
  }
  const t = new Date(value.trim());
  if (Number.isNaN(t.getTime())) throw new EventInputError(`${label} needs a date and time.`, "time_invalid");
  return t.toISOString();
}

/**
 * Start and end, checked: the end after the start, no longer than two weeks,
 * and (for a new or changed time) not already over.
 */
export function checkTimes(start: string | null, end: string | null, now = Date.now()): { start_time: string; end_time: string } {
  if (!start) throw new EventInputError("An event needs a start time.", "start_required");
  if (!end) throw new EventInputError("An event needs an end time.", "end_required");
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (e <= s) throw new EventInputError("The end time must be after the start time.", "end_before_start");
  if (e - s > MAX_DURATION_MS) throw new EventInputError("An event can run for at most two weeks.", "too_long_duration");
  if (e <= now) throw new EventInputError("This event would already be over. Check the date.", "already_over");
  return { start_time: start, end_time: end };
}

/** The online link, checked: http or https only. */
export function onlineLink(value: unknown): string | null {
  const s = text(value, 500, "The link");
  if (!s) return null;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new EventInputError("The online link must be a full web address (https://…).", "link_invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new EventInputError("The online link must be a web address (https://…).", "link_invalid");
  }
  return url.toString();
}

/** Where it is, from the fields a form sends: a venue (and address), or an online link. */
export function locationFrom(fields: {
  venue?: unknown;
  street_address?: unknown;
  locality?: unknown;
  region?: unknown;
  postal_code?: unknown;
  country?: unknown;
  online_url?: unknown;
}): EventLocation {
  const venue = text(fields.venue, VENUE_MAX, "The place");
  const href = onlineLink(fields.online_url);
  if (venue && href) throw new EventInputError("Give a place or an online link, not both.", "location_both");
  if (href) return { type: "Link", name: "Online", href };
  if (!venue) throw new EventInputError("Say where the event is: a place, or an online link.", "location_required");
  const address: PostalAddress = { type: "PostalAddress" };
  const put = (key: Exclude<keyof PostalAddress, "type">, value: unknown, label: string) => {
    const v = text(value, ADDRESS_FIELD_MAX, label);
    if (v) address[key] = v;
  };
  put("streetAddress", fields.street_address, "The street address");
  put("addressLocality", fields.locality, "The town or city");
  put("addressRegion", fields.region, "The region");
  put("postalCode", fields.postal_code, "The postal code");
  put("addressCountry", fields.country, "The country");
  return Object.keys(address).length > 1 ? { type: "Place", name: venue, address } : { type: "Place", name: venue };
}

/** A location already in the stored shape (an edit sends one), checked the same way. */
export function checkLocation(value: unknown): EventLocation {
  if (!value || typeof value !== "object") throw new EventInputError("Say where the event is.", "location_required");
  const v = value as Record<string, unknown>;
  if (v.type === "Link") return locationFrom({ online_url: v.href });
  const a = (v.address && typeof v.address === "object" ? v.address : {}) as Record<string, unknown>;
  return locationFrom({
    venue: v.name,
    street_address: a.streetAddress,
    locality: a.addressLocality,
    region: a.addressRegion,
    postal_code: a.postalCode,
    country: a.addressCountry,
  });
}

/** One line for where it is: "Community room, 1 High St" or "Online". */
export function locationLine(location: EventLocation): string {
  if (location.type === "Link") return "Online";
  const a = location.address;
  const parts = a ? [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry].filter(Boolean) : [];
  return [location.name, ...parts].join(", ");
}

/**
 * What every event this type writes carries about it under `process` (always
 * public): the title, and the event block the wire lifts into the AS2 Event
 * (startTime, endTime, location, summary, content, ical:status).
 */
export function eventBlock(title: string, description: string, state: EventState): Record<string, unknown> {
  const event: Record<string, unknown> = {
    start_time: state.start_time,
    end_time: state.end_time,
    location: state.location,
    status: state.cancelled ? "CANCELLED" : "CONFIRMED",
  };
  const body = description.trim();
  if (body) {
    event.summary = body.length > SUMMARY_MAX ? `${body.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : body;
    event.description = body;
  }
  return { title, event };
}
