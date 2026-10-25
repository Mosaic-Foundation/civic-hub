// Date formatting shared by components and pages: one function per distinct
// output, so no page keeps its own copy. Kept out of component files so they
// export only components (react-refresh/only-export-components).
//
// Two families, and the names say which:
//   - the plain names (formatDate, formatShortDate, formatShortDateTime) are
//     "en-US" always: the same text for every reader;
//   - absoluteDate, local* and *OfDay follow the reader's locale (the
//     browser's), as the pages that used them always have.
// The examples are what "en-US" gives.

/** "October 24, 2026": en-US, month in full. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** "Oct 24, 2026": en-US, month short. */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Oct 24, 2026, 3:30 PM": en-US, month short, with the time. */
export function formatShortDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "September 25, 2026": a date with no time, for receipts (2026-10-06). The reader's locale. */
export function absoluteDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** "Oct 24, 2026": month short. The reader's locale. */
export function localShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Oct 24, 2026 at 03:30 PM". The reader's locale. */
export function localDateAtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} at ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

/** "Oct 24, 2026, 3:30 PM": a moment, for logs and queues. The reader's locale. */
export function localTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A date-only string (YYYY-MM-DD) or a full timestamp. `new Date` on a
 * date-only string is read as UTC, which can shift the day backward in the
 * reader's time zone, so a date-only string is read at noon instead.
 */
function dayOrMoment(iso: string): Date {
  return iso.includes("T") ? new Date(iso) : new Date(`${iso}T12:00:00`);
}

/** "Oct 24, 2026", from a date-only string or a timestamp. The reader's locale. */
export function localShortDateOfDay(iso: string): string {
  return dayOrMoment(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "October 24, 2026", from a date-only string or a timestamp. The reader's locale. */
export function absoluteDateOfDay(iso: string): string {
  return dayOrMoment(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Relative time string per Slice-8 rules. < 7 days renders relative;
 * older renders as an absolute short date (e.g. "Apr 14, 2026"). The
 * full datetime is exposed via the `title` attribute by the caller.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return then.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "October 24, 2026 at 03:30 PM": a moment in full, for a time's title. The reader's locale. */
export function absoluteTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} at ${time}`;
}
