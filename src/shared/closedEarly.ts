// Close early (Actions slice, 2026-10-13): an admin closing a process before
// its deadline must say why, and the process page and its brief say so.
// What is stored on the process (`state.closed_early`), the limits on the
// note, and the one sentence every surface shows. Pure, so the server (the
// read model, the brief) and the UI use the same words.

/** What a close before the deadline records on the process. */
export interface ClosedEarlyRecord {
  /** When it was closed (ISO). */
  at: string;
  /** The deadline it had (ISO). */
  original_deadline: string;
  /** The admin's note, verbatim. */
  note: string;
}

export const CLOSE_EARLY_NOTE_MAX = 1000;

/** The calendar date of an instant in a time zone, as YYYY-MM-DD. */
function dayIn(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "October 13, 2026": an instant's date in the hub's time zone. */
function longDate(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone, month: "long", day: "numeric", year: "numeric" });
}

/** Whole calendar days from the close to the original deadline, in the hub's time zone. */
export function daysEarly(record: Pick<ClosedEarlyRecord, "at" | "original_deadline">, timeZone: string): number {
  const from = Date.parse(`${dayIn(record.at, timeZone)}T00:00:00Z`);
  const to = Date.parse(`${dayIn(record.original_deadline, timeZone)}T00:00:00Z`);
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/**
 * "Closed early on October 13, 2026, 3 days before the original date of
 * October 16, 2026." Same calendar day: "…, earlier on the original closing
 * day." The admin's note follows it on its own line, as "Admin note: …".
 */
export function closedEarlyLine(record: Pick<ClosedEarlyRecord, "at" | "original_deadline">, timeZone: string): string {
  const on = longDate(record.at, timeZone);
  const days = daysEarly(record, timeZone);
  if (days === 0) return `Closed early on ${on}, earlier on the original closing day.`;
  const n = days === 1 ? "1 day" : `${days} days`;
  return `Closed early on ${on}, ${n} before the original date of ${longDate(record.original_deadline, timeZone)}.`;
}

/** A stored record, read defensively (state is JSON). */
export function readClosedEarly(value: unknown): ClosedEarlyRecord | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.at !== "string" || typeof v.original_deadline !== "string" || typeof v.note !== "string") return null;
  return { at: v.at, original_deadline: v.original_deadline, note: v.note };
}
