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

import { getAllEvents } from "../events/eventStore.js";
import { getProcess } from "./processService.js";
import { isPubliclyFetchable } from "./processLifecycle.js";
import type { Process } from "../models/process.js";

export interface BrokenPublication {
  process_id: string;
  process_type: string;
  /** When the card the reader sees was published. */
  published_at: string;
  /** Why the page does not resolve, in words an operator can act on. */
  reason: string;
}

/**
 * Whether a process that has announced a published result is actually
 * reachable by the public right now.
 *
 * Two gates, because a process can fail either:
 *   - the process-level status gate (archived / still in review), and
 *   - a module's own approval gate, where "published" lives in state rather
 *     than in the row's status. Meeting summaries and briefs both work that
 *     way, and it is precisely the gate the upgrade pass tripped.
 */
export function publicationFailure(process: Process | null): string | null {
  if (!process) return "the process no longer exists";

  if (!isPubliclyFetchable(process.status)) {
    return `the process is "${process.status}", which is not publicly fetchable`;
  }

  const state = (process.state ?? {}) as Record<string, unknown>;
  const approval = state.approval_status;
  if (typeof approval === "string" && approval !== "published") {
    return `it announced a published result but its approval_status is "${approval}" — the public page will 404`;
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
    const process = (await getProcess(process_id).catch(() => null)) ?? null;
    const reason = publicationFailure(process);
    if (reason) {
      broken.push({
        process_id,
        process_type: process?.definition.type ?? type,
        published_at: timestamp,
        reason,
      });
    }
  }

  // Newest first — a link that broke today matters more than a historical one.
  broken.sort((a, b) => b.published_at.localeCompare(a.published_at));
  return broken;
}
