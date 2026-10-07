// One page of the hub's own feed — what GET /api/feed serves (2026-10-07).
//
// Before: the feed read every event in one request, PostgREST answered with
// the newest 1,000, and the browser was sent all of them to filter and page
// itself. A hub past 1,000 events lost its oldest cards without a word, and
// every page load carried the whole log.
//
// Now the server reads the log newest first, in batches, keeps only what
// becomes a card, and stops when it has a page. The answer carries a cursor
// for the next page, or null when there is nothing older; the reader's "Load
// more" asks for it. Every rule the old read applied is applied here, per
// batch, against the batch's own processes rather than hub-wide id sets
// (which had the same cap):
//   - an event whose process no longer exists is left out (no ghost cards);
//   - an archived or pending-review process, or one whose plugin is off,
//     shows nothing;
//   - restricted events are for admins only (in the query);
//   - only the newest publication of a process is a card;
//   - a sample process's events are marked `sample`.
// In "cards" mode (the feed itself) only events the shared classifier turns
// into a card are kept, optionally of one surface (the filter pills), so the
// page holds exactly what the reader sees.

import { forHub } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import { getEventPage, type EventCursor } from "../events/eventStore.js";
import {
  FEED_EVENT_TYPES,
  classifyActivity,
  type ActivitySurface,
} from "../shared/feedActivity.js";
import { NON_PUBLIC_STATUSES } from "./processLifecycle.js";
import { isProcessTypeEnabled } from "./pluginGate.js";
import type { CivicEvent } from "../models/event.js";
import type { ProcessStatus } from "../models/process.js";

export const FEED_DEFAULT_LIMIT = 25;
export const FEED_MAX_LIMIT = 100;

/** Rows read from the log per round trip. */
const BATCH = 100;
/**
 * Rows one request reads at most before answering with what it has and a
 * cursor. A filter that matches little (one surface on a busy hub) would
 * otherwise read the whole log in one request. A short page with a cursor is
 * a valid answer: the reader's next request continues from it.
 */
const MAX_SCAN = 2000;

const RESULT_PUBLISHED = "civic.process.result_published";

export type FeedEvent = CivicEvent & { sample?: true };

export interface FeedPageRequest {
  limit: number;
  cursor: EventCursor | null;
  /** An explicit lookup of one process: every event of it, nothing hidden. */
  processId?: string;
  /** Events of this type only (no card filter). */
  eventType?: string;
  /** Cards of this surface only; cards mode only. */
  surface?: ActivitySurface;
  isAdmin: boolean;
}

export interface FeedPageResult {
  events: FeedEvent[];
  /** Where the next (older) page starts; null when there is nothing older. */
  nextCursor: EventCursor | null;
}

interface ProcessFacts {
  status: ProcessStatus;
  type: string;
  is_sample: boolean;
}

export async function readFeedPage(req: FeedPageRequest): Promise<FeedPageResult> {
  // Cards mode is the feed itself; a process or a type asked for by name is a
  // lookup and gets the raw events, as before.
  const cards = !req.processId && !req.eventType;
  const eventTypes = req.eventType ? [req.eventType] : cards ? [...FEED_EVENT_TYPES] : undefined;

  const out: FeedEvent[] = [];
  let cursor = req.cursor;
  let scanned = 0;

  for (;;) {
    const page = await getEventPage({
      limit: BATCH,
      cursor,
      processId: req.processId,
      eventTypes,
      excludeRestricted: !req.isAdmin,
      includeSample: true,
    });
    scanned += page.events.length;

    const kept = await keep(page.events, req, cards);
    for (const event of page.events) {
      const shown = kept.get(event.id);
      if (!shown) continue;
      out.push(shown);
      if (out.length === req.limit) {
        const last = page.events[page.events.length - 1];
        const exhausted = !page.nextCursor && event.id === last?.id;
        return {
          events: out,
          nextCursor: exhausted ? null : { createdAt: event.timestamp, id: event.id },
        };
      }
    }

    if (!page.nextCursor) return { events: out, nextCursor: null };
    cursor = page.nextCursor;
    if (scanned >= MAX_SCAN) return { events: out, nextCursor: cursor };
  }
}

/** The batch's events that are shown, by id (sample ones marked). */
async function keep(
  events: CivicEvent[],
  req: FeedPageRequest,
  cards: boolean,
): Promise<Map<string, FeedEvent>> {
  const shown = new Map<string, FeedEvent>();
  if (events.length === 0) return shown;

  const facts = await processFacts(events);
  const newest = req.processId ? null : await newestPublications(events, req.isAdmin);

  for (const event of events) {
    const pid = event.process_id;
    const fact = pid ? facts.get(pid) : undefined;

    if (!req.processId && pid) {
      if (!fact) continue; // its process is gone: no ghost card
      if (NON_PUBLIC_STATUSES.includes(fact.status)) continue;
      if (!isProcessTypeEnabled(fact.type)) continue;
    }

    if (cards) {
      const activity = classifyActivity(event);
      if (!activity) continue;
      if (req.surface && activity.surface !== req.surface) continue;
      const type = emittedProcessType(event);
      if (type && !isProcessTypeEnabled(type)) continue;
    }

    if (newest && event.event_type === RESULT_PUBLISHED && pid) {
      if (newest.get(pid) !== event.timestamp) continue;
    }

    shown.set(event.id, fact?.is_sample ? { ...event, sample: true } : event);
  }
  return shown;
}

/** Status, type and sample flag of each process the batch's events name. */
async function processFacts(events: CivicEvent[]): Promise<Map<string, ProcessFacts>> {
  const ids = [...new Set(events.map((e) => e.process_id).filter(Boolean))];
  const facts = new Map<string, ProcessFacts>();
  if (ids.length === 0) return facts;
  // At most BATCH ids, so at most BATCH rows: one request, under the cap.
  const rows = await forHub(currentHubId())
    .from("processes")
    .select<ProcessFacts & { id: string }>("id, status, type, is_sample")
    .in("id", ids);
  for (const r of rows) facts.set(r.id, { status: r.status, type: r.type, is_sample: r.is_sample });
  return facts;
}

/**
 * The newest publication of each process that has one in the batch. A process
 * can be published more than once (a meeting summary upgraded from agenda to
 * minutes is approved again); both events stay in the log, but the feed is a
 * projection of current state, so only the newest is a card. The newer one
 * may be on an earlier page, so it is looked up, not inferred from the batch.
 * Restricted publications count only for an admin, who sees them.
 */
async function newestPublications(
  events: CivicEvent[],
  isAdmin: boolean,
): Promise<Map<string, string> | null> {
  const ids = [
    ...new Set(
      events.filter((e) => e.event_type === RESULT_PUBLISHED && e.process_id).map((e) => e.process_id),
    ),
  ];
  if (ids.length === 0) return null;
  let q = forHub(currentHubId())
    .from("events")
    .select<{ process_id: string; created_at: string }>("process_id, created_at")
    .eq("event_type", RESULT_PUBLISHED)
    .in("process_id", ids);
  if (!isAdmin) q = q.or("meta->>visibility.is.null,meta->>visibility.neq.restricted");
  // A process is published a handful of times at most; ids ≤ BATCH keeps this
  // far under the cap, and the data layer would refuse it if it ever were not.
  const rows = await q;
  const newest = new Map<string, string>();
  for (const r of rows) {
    const seen = newest.get(r.process_id);
    if (!seen || r.created_at > seen) newest.set(r.process_id, r.created_at);
  }
  return newest;
}

/** `data.process.type`, or the legacy flat `data.process_type`, as emitted. */
function emittedProcessType(event: CivicEvent): string | undefined {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const nested = (data.process as { type?: unknown } | undefined)?.type;
  if (typeof nested === "string") return nested;
  const flat = data.process_type;
  return typeof flat === "string" ? flat : undefined;
}
