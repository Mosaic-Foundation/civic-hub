// Small text helpers the feed kinds share (formerly private to Feed.tsx and
// FeedPost.tsx). Pure.

/** The first non-empty line of a description, trimmed ("" when none). */
export function summaryFromDescription(description: string | undefined): string {
  if (!description) return "";
  const firstLine = description.split(/\r?\n/).find((l) => l.trim().length > 0);
  return firstLine?.trim() ?? "";
}

/** "1234" → "1.2k". Below 1000 returns the integer untouched. */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  // 1.2k, 1.5k, 12k — one decimal under 10k, rounded otherwise.
  if (k < 10) return `${k.toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(k)}k`;
}

/**
 * Convert a max-block-start in seconds to a coarse duration label
 * ("12 min", "1h 5m"). Returns null when input is null / invalid.
 * "At least this long" — actual videos run past the last marked topic.
 */
export function formatDuration(startSeconds: number | null): string | null {
  if (startSeconds == null || !Number.isFinite(startSeconds) || startSeconds <= 0) {
    return null;
  }
  const minutes = Math.max(1, Math.ceil(startSeconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes - h * 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Format a YYYY-MM-DD (or full ISO) date for feed post titles. Falls back
 * to the raw string if parsing fails, so truncated or malformed dates
 * don't render as "Invalid Date".
 */
export function formatMeetingDate(iso: string): string {
  if (!iso) return "(date unknown)";
  const d = iso.includes("T")
    ? new Date(iso)
    : new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
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
