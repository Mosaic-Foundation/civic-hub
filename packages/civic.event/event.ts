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

/** Its picture: an image the hub's upload route stored for it, and what it shows. */
export interface EventImage {
  url: string;
  alt: string;
}

export interface EventState {
  /** When it starts and ends (ISO, UTC). */
  start_time: string;
  end_time: string;
  location: EventLocation;
  /** Set when it was cancelled; it stays on the calendar, marked. */
  cancelled: { at: string; reason: string } | null;
  /** The IANA zone its times are given in (0.3.0). Absent on older events: the hub's. */
  time_zone?: string;
  /** Its picture (0.3.0), or none. */
  image?: EventImage | null;
  /** How many may say they are going (0.3.0); null or absent: no limit. */
  capacity?: number | null;
}

export const TITLE_MAX = 120;
export const VENUE_MAX = 120;
export const ADDRESS_FIELD_MAX = 120;
export const REASON_MAX = 500;
export const ALT_MAX = 200;
export const CAPACITY_MAX = 100_000;
export const SUBJECT_MAX = 120;
export const MESSAGE_MAX = 2000;
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

/** A time zone this runtime knows, or null when empty. */
export function timeZoneOf(value: unknown): string | null {
  const z = typeof value === "string" ? value.trim() : "";
  if (!z) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
  } catch {
    throw new EventInputError(`"${z}" is not a time zone.`, "time_zone_invalid");
  }
  return z;
}

/** A limit on who may go: a whole number from 1, or null for none. */
export function capacityOf(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 1 || n > CAPACITY_MAX) {
    throw new EventInputError(`The limit must be a whole number from 1 to ${CAPACITY_MAX.toLocaleString("en-US")}.`, "capacity_invalid");
  }
  return n;
}

/**
 * Its picture: a URL the hub's upload route gave for this type (its folder,
 * `/types/civic.event/`), never an image elsewhere on the web; null when none.
 */
export function imageOf(url: unknown, alt: unknown): EventImage | null {
  const u = typeof url === "string" ? url.trim() : "";
  if (!u) return null;
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new EventInputError("That picture can't be used. Upload it again.", "image_invalid");
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || !parsed.pathname.includes("/types/civic.event/")) {
    throw new EventInputError("That picture can't be used. Upload it again.", "image_invalid");
  }
  return { url: parsed.toString(), alt: text(alt, ALT_MAX, "The picture's description") };
}

/** An image's media type, from its stored name (the upload route names it by type). */
function mediaTypeOf(url: string): string | null {
  const ext = /\.([a-z0-9]+)(?:$|\?)/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : null;
}

// --- How long it runs: the form's end and duration, kept together -------------

/** Minutes from start to end, or null when either is missing or the end is not after. */
export function durationMinutes(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const m = Math.round((Date.parse(end) - Date.parse(start)) / 60_000);
  return Number.isFinite(m) && m > 0 ? m : null;
}

/** The end `minutes` after `start` (ISO). */
export function endAfter(start: string, minutes: number): string {
  return new Date(Date.parse(start) + minutes * 60_000).toISOString();
}

/**
 * The end a form fills in when a start is chosen: one hour after it, on the
 * same day in the event's zone (an event starting late ends at the day's last
 * minute rather than tomorrow).
 */
export function defaultEnd(start: string, timeZone: string): string {
  const hourLater = endAfter(start, 60);
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone });
  if (day(hourLater) === day(start)) return hourLater;
  // The last whole minute of the start's day: walk back from an hour later.
  let t = Date.parse(hourLater);
  while (day(new Date(t).toISOString()) !== day(start)) t -= 60_000;
  return new Date(t).toISOString();
}

/** "1 h 30 min", "45 min", "2 h", "1 day 2 h". */
export function formatDuration(minutes: number): string {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return [d ? `${d} ${d === 1 ? "day" : "days"}` : "", h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ") || "0 min";
}

/**
 * A duration as someone types it: "90", "90m", "1:30", "1h30", "1 h 30 min",
 * "2 hours", "1.5h", "1 day". Minutes; null when it can't be read or is not
 * more than nothing.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) > 0 ? Number(s) : null;
  const clock = /^(\d+):(\d{1,2})$/.exec(s);
  if (clock) {
    const m = Number(clock[1]) * 60 + Number(clock[2]);
    return Number(clock[2]) < 60 && m > 0 ? m : null;
  }
  let total = 0;
  let rest = s;
  let lastUnit = "";
  const unit = /^\s*(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)?(?![a-z])\s*/;
  while (rest) {
    const m = unit.exec(rest);
    if (!m || m[0] === "") return null;
    const n = Number(m[1]);
    // A bare number reads as minutes only after hours ("1h30").
    const u = m[2] ?? (lastUnit === "h" ? "m" : "");
    if (!u) return null;
    total += u.startsWith("d") ? n * 1440 : u.startsWith("h") ? n * 60 : n;
    lastUnit = u[0];
    rest = rest.slice(m[0].length);
  }
  const minutes = Math.round(total);
  return minutes > 0 ? minutes : null;
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

/**
 * When it is, in its own zone, named: "Saturday, November 14, 2026, 7:00 PM –
 * 9:00 PM CST". For a message or a calendar file a reader anywhere reads right.
 */
export function whenText(start: string, end: string, timeZone: string): string {
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const time = (iso: string, zone = false) =>
    new Date(iso).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit", ...(zone ? { timeZoneName: "short" } : {}) });
  return day(start) === day(end)
    ? `${day(start)}, ${time(start)} – ${time(end, true)}`
    : `${day(start)}, ${time(start)} – ${day(end)}, ${time(end, true)}`;
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
export function eventBlock(title: string, description: string, state: EventState, going?: number): Record<string, unknown> {
  const event: Record<string, unknown> = {
    start_time: state.start_time,
    end_time: state.end_time,
    location: state.location,
    status: state.cancelled ? "CANCELLED" : "CONFIRMED",
  };
  // 0.3.0, each only where the event has it, so an event without them reads
  // as it always did (the wire snapshot).
  if (state.time_zone) event.time_zone = state.time_zone;
  if (state.image) {
    const type = mediaTypeOf(state.image.url);
    event.image = { type: "Image", url: state.image.url, ...(type ? { mediaType: type } : {}), ...(state.image.alt ? { name: state.image.alt } : {}) };
  }
  if (state.capacity) {
    event.capacity = state.capacity;
    if (going !== undefined) event.remaining_capacity = Math.max(0, state.capacity - going);
  }
  const body = description.trim();
  if (body) {
    event.summary = body.length > SUMMARY_MAX ? `${body.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : body;
    event.description = body;
  }
  return { title, event };
}

/** Where, in a message: "Community room, 1 High St" or "Online: https://…". */
function whereText(location: EventLocation): string {
  return location.type === "Link" ? `Online: ${location.href}` : locationLine(location);
}

/** What changed about an event, in words its people going read (null: nothing they need told). */
export function changeText(before: EventState, after: EventState): string | null {
  const lines: string[] = [];
  const zone = after.time_zone ?? before.time_zone ?? "UTC";
  const was = whenText(before.start_time, before.end_time, before.time_zone ?? zone);
  const now = whenText(after.start_time, after.end_time, zone);
  if (before.start_time !== after.start_time || before.end_time !== after.end_time || was !== now) {
    lines.push(`When: ${now}`, `(was ${was})`);
  }
  if (JSON.stringify(before.location) !== JSON.stringify(after.location)) {
    lines.push(`Where: ${whereText(after.location)}`, `(was ${whereText(before.location)})`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}
