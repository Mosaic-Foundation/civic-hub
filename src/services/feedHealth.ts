// Feed link health — do published cards still point at pages the public can see?
//
// WHY THIS EXISTS
// The meeting-summary cron reported complete success on the run that broke two
// live pages. Nothing failed: discovery worked, summarization worked, every
// counter read zero. What broke was PUBLICATION STATE — the upgrade pass
// cleared `published_at` on already-published summaries, so their public pages
// began returning 404 while their feed cards stayed up. A resident clicking
// either got nothing, and no cron-level guard could see it, because from the
// job's point of view the run was clean.
//
// The invariant this checks is the one that actually matters to a reader:
// every card in the public feed resolves to content the public can fetch. It
// is deliberately independent of whichever job created the card, so it catches
// the next cause as well as the one we know about.
//
// WHAT IS NOT BROKEN (2026-10-07, review M1). An archived or deleted process
// is not a broken link: both feeds already hide its card (eventController,
// feedController), so no reader can click it. Counting them made every archive
// of something with a result a daily "failed" run, forever. Only a process
// that is still on the feed and whose page does not open is reported.

import { getAllEvents } from "../events/eventStore.js";
import { getProcess } from "./processService.js";
import { isPubliclyFetchable } from "./processLifecycle.js";
import type { Process } from "../models/process.js";

export interface BrokenPublication {
  process_id: string;
  process_type: string;
  /** The process's title, so an admin can find it. */
  title: string;
  /** When the card the reader sees was published. */
  published_at: string;
  /** Why the page does not open, as the end of a sentence an admin reads:
   *  "its approval is \"pending\", so its page shows \"not found\"". */
  reason: string;
}

/**
 * Whether a process that has announced a published result is actually
 * reachable by the public right now.
 *
 * Two gates, because a process can fail either:
 *   - the process-level status gate (pulled back into review), and
 *   - a module's own approval gate, where "published" lives in state rather
 *     than in the row's status. Meeting summaries work that way, and it is
 *     precisely the gate the upgrade pass tripped.
 *
 * A missing or archived process is NOT a failure: the feeds hide its card.
 */
export function publicationFailure(process: Process | null): string | null {
  if (!process) return null;
  if (process.status === "archived") return null;

  if (!isPubliclyFetchable(process.status)) {
    return `it is back in review ("${process.status}"), so its page is hidden from the public`;
  }

  const state = (process.state ?? {}) as Record<string, unknown>;
  const approval = state.approval_status;
  if (typeof approval === "string" && approval !== "published") {
    return `its approval is "${approval}", so its page shows "not found"`;
  }

  return null;
}

/**
 * Every publicly-announced result whose page no longer resolves.
 *
 * Only the NEWEST publication per process is considered: a process may
 * legitimately be published more than once (see the meeting-summary upgrade
 * path), and the feed collapses those to the newest, so that is the card a
 * reader can actually click.
 */
export async function findBrokenPublications(): Promise<BrokenPublication[]> {
  const events = await getAllEvents();

  const newest = new Map<string, { timestamp: string; type: string }>();
  for (const e of events) {
    if (e.event_type !== "civic.process.result_published") continue;
    if (!e.process_id) continue;
    // Restricted events are never on the public feed, so a broken link behind
    // one is not reader-visible.
    if (e.meta?.visibility === "restricted") continue;
    const seen = newest.get(e.process_id);
    if (!seen || e.timestamp > seen.timestamp) {
      const data = (e.data ?? {}) as Record<string, unknown>;
      const proc = data.process as Record<string, unknown> | undefined;
      newest.set(e.process_id, {
        timestamp: e.timestamp,
        type: typeof proc?.type === "string" ? proc.type : "unknown",
      });
    }
  }

  const broken: BrokenPublication[] = [];
  for (const [process_id, { timestamp, type }] of newest) {
    // A failed lookup throws: the caller reports the check as errored rather
    // than this reading a database wobble as "deleted, so fine".
    const process = (await getProcess(process_id)) ?? null;
    const reason = publicationFailure(process);
    if (reason && process) {
      broken.push({
        process_id,
        process_type: process.definition.type ?? type,
        title: process.title,
        published_at: timestamp,
        reason,
      });
    }
  }

  // Newest first — a link that broke today matters more than a historical one.
  broken.sort((a, b) => b.published_at.localeCompare(a.published_at));
  return broken;
}
