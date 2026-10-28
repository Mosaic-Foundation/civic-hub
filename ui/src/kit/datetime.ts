// The date-time control's conversions (engine 2, A7): an ISO instant to the
// browser's datetime-local value and back. In the reader's time zone, or in
// the one named (Events 2, E4: an event's own zone, whatever the reader's).
// Apart from the components so the kit's component file exports only
// components.

const pad = (n: number) => String(n).padStart(2, "0");

/** The wall-clock fields of `ms` in `timeZone`. */
function wallClock(ms: number, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return { y: +parts.year, mo: +parts.month, d: +parts.day, h: +parts.hour, mi: +parts.minute };
}

/** How far `timeZone` is ahead of UTC at `ms`, in ms. */
function offsetAt(ms: number, timeZone: string): number {
  const w = wallClock(ms, timeZone);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - Math.floor(ms / 60_000) * 60_000;
}

/** An ISO instant as a datetime-local value, in `timeZone` or the reader's ("" for none). */
export function toLocalInput(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (timeZone) {
    const w = wallClock(d.getTime(), timeZone);
    return `${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`;
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * A datetime-local value as an ISO instant, read in `timeZone` or the
 * reader's, or null. A time a clock skips (the spring-forward hour) reads as
 * the same wall time after the change; one it repeats, as the first.
 */
export function fromLocalInput(value: string, timeZone?: string): string | null {
  if (!value) return null;
  if (!timeZone) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // The zone's offsets a day either side: the wall time is one of these
  // instants, both when a change of clocks repeats it (the first), and the
  // first when the clocks skip it (the same wall time after the change).
  const before = asUtc - offsetAt(asUtc - 86_400_000, timeZone);
  const after = asUtc - offsetAt(asUtc + 86_400_000, timeZone);
  const shows = (ms: number) => toLocalInput(new Date(ms).toISOString(), timeZone) === value.slice(0, 16);
  const real = [before, after].filter(shows);
  return new Date(real.length > 0 ? Math.min(...real) : before).toISOString();
}
