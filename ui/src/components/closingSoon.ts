// The feed's "closing soon" cards (Events 4, Adam, 2026-11-09): an open vote,
// proposal or conversation, from 48 hours before it closes until it closes.
// Built here from the process's close time (GET /api/feed/closing), not from
// an event, so the wire is unchanged. One card per process, placed by the
// time it entered the window. Pure, so it is tested without a browser
// (closingSoon.test.ts).

import type { ClosingSoonRow, FeedSurface } from "../services/api";

/** A feed row: a card made from an event, or a closing-soon card. */
export type FeedRow<P> = { kind: "post"; post: P; at: string } | { kind: "closing"; row: ClosingSoonRow; at: string };

/** The zone as an option, or none when it is unset or not one the browser knows. */
function zone(timeZone: string | null): { timeZone?: string } {
  if (!timeZone) return {};
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return { timeZone };
  } catch {
    return {};
  }
}

/** The calendar day of an instant in a zone, as a count of days, so two can be subtracted. */
function dayNumber(ms: number, timeZone: string | null): number {
  const parts = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "numeric", day: "numeric", ...zone(timeZone) })
    .formatToParts(new Date(ms))
    .reduce<Record<string, number>>((acc, p) => (p.type === "literal" ? acc : { ...acc, [p.type]: Number(p.value) }), {});
  return Math.round(Date.UTC(parts.year!, parts.month! - 1, parts.day!) / 86_400_000);
}

/**
 * "Closes today at 5:00 PM", "Closes tomorrow at 5:00 PM", "Closes in 2 days",
 * by the calendar in the hub's zone.
 */
export function closesWords(closesAt: string, now: number, timeZone: string | null): string {
  const at = Date.parse(closesAt);
  const days = dayNumber(at, timeZone) - dayNumber(now, timeZone);
  const time = new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...zone(timeZone) });
  if (days <= 0) return `Closes today at ${time}`;
  if (days === 1) return `Closes tomorrow at ${time}`;
  return `Closes in ${days} days`;
}

/** Whether a filter shows closing cards: All and Activity, not Announcements or Meeting summaries. */
export function closingShownIn(surface: FeedSurface | undefined): boolean {
  return surface === undefined || surface === "activity";
}

/**
 * The feed's rows, newest first: the event cards in their order, with each
 * closing card still open set in by the time it entered the window. While
 * older pages remain, a card older than the last one loaded waits for them,
 * so "Load more" never puts it out of order.
 */
export function withClosing<P>(
  posts: Array<{ post: P; at: string }>,
  closing: ClosingSoonRow[],
  opts: { now: number; hasMore: boolean },
): Array<FeedRow<P>> {
  // Instants, not strings: an event's timestamp and a close time may be written differently.
  const t = (iso: string) => Date.parse(iso);
  const oldest = posts.length > 0 ? t(posts[posts.length - 1]!.at) : null;
  const cards = closing
    .filter((c) => t(c.closes_at) > opts.now)
    .filter((c) => !opts.hasMore || oldest === null || t(c.since) >= oldest)
    .sort((a, b) => t(b.since) - t(a.since) || a.process_id.localeCompare(b.process_id));
  const out: Array<FeedRow<P>> = [];
  let i = 0;
  for (const p of posts) {
    while (i < cards.length && t(cards[i]!.since) >= t(p.at)) {
      out.push({ kind: "closing", row: cards[i]!, at: cards[i]!.since });
      i++;
    }
    out.push({ kind: "post", post: p.post, at: p.at });
  }
  for (; i < cards.length; i++) out.push({ kind: "closing", row: cards[i]!, at: cards[i]!.since });
  return out;
}
