// Append-only event store — backed by Postgres (events table).
//
// Events are the PRIMARY public interface of the hub.
// External systems should consume from this store (via /events),
// not from internal process APIs.
//
// The schema enforces append-only at the database level via a trigger
// that blocks UPDATE/DELETE on the events table. clearEvents() is the
// only DELETE path, and it is gated to dev-only callers.
//
// Per hub since Phase 2a: every read and the append go through forHub(), so
// GET /events, the feed and the digest see only the hub in scope, and an
// event is stored under the hub that emitted it.
//
// Sample events (Phase 7) — `is_sample`, stamped by the database from the
// event's process — are illustrative, not public record. The reads that feed
// the public wire (GET /events, /activities/:id, and so any federation) and
// the resident digest leave them out HERE, in the query, so no caller can
// forget. The hub's own feed and admin views read them, with a Sample badge.

import { forHub, forHubDevReset, type HubDb, type HubSelect } from "../db/forHub.js";
import { readAll } from "../db/readAll.js";
import { currentHubId } from "../config/hubContext.js";
import { CivicEvent } from "../models/event.js";

/** The hub in scope. The log is only ever read or appended inside one. */
function db(): HubDb {
  return forHub(currentHubId());
}

// --- Row <-> model mapping -------------------------------------------------

interface EventRow {
  id: string;
  version: string;
  event_type: string;
  process_id: string | null;
  actor: string | null;
  jurisdiction: string | null;
  action_url: string | null;
  source: { hub_id: string; hub_url: string } | null;
  dedupe_key: string | null;
  data: Record<string, unknown> | null;
  meta: { visibility: "public" | "restricted" } | null;
  created_at: string;
}

function rowToEvent(row: EventRow): CivicEvent {
  return {
    id: row.id,
    version: row.version,
    event_type: row.event_type,
    timestamp: row.created_at,
    process_id: row.process_id ?? "",
    actor: row.actor ?? "",
    jurisdiction: row.jurisdiction ?? "",
    action_url: row.action_url ?? "",
    source: row.source ?? { hub_id: "", hub_url: "" },
    ...(row.dedupe_key ? { dedupe_key: row.dedupe_key } : {}),
    data: row.data ?? {},
    meta: row.meta ?? { visibility: "public" },
  };
}

export function eventToRow(event: CivicEvent): EventRow {
  return {
    id: event.id,
    // The event's own timestamp IS the row's created_at. The emitter stamps
    // "now" unless a caller passed an explicit `timestamp` (sync paths, seed
    // scripts), and the read side maps created_at straight back onto
    // `timestamp` — so omitting it here (and letting the column default to
    // now()) silently discarded every override and left the feed's ordering
    // disagreeing with the event it was ordering. Fixed 2026-09-01.
    created_at: event.timestamp,
    version: event.version,
    event_type: event.event_type,
    process_id: event.process_id || null,
    actor: event.actor || null,
    jurisdiction: event.jurisdiction || null,
    action_url: event.action_url || null,
    source: event.source,
    dedupe_key: event.dedupe_key ?? null,
    data: event.data ?? {},
    meta: event.meta,
  };
}

// --- Public API ------------------------------------------------------------

export async function appendEvent(event: CivicEvent): Promise<void> {
  // Events are the source of truth; never silently drop — forHub() throws.
  await db().from("events").insert(eventToRow(event));
}

// There is no "every event" read (removed 2026-10-07). It asked for the whole
// log in one request, PostgREST answered with the newest 1,000 rows, and the
// feed, the moderation log and feed health silently lost everything older.
// Each caller now asks for what it needs: a page (getEventPage), one process
// (getEventsByProcessId), or one kind of event (getModerationEvents,
// getResultPublications), and the long ones page through readAll().

/** Newest first, then by id, so pages of a read are stable. */
function newestFirst<T>(q: HubSelect<T>): HubSelect<T> {
  return q.order("created_at", { ascending: false }).order("id", { ascending: false });
}

/**
 * Every event of one process, newest first, optionally of some types only. A
 * vote has an event per ballot, so a busy one passes 1,000: paged.
 */
export async function getEventsByProcessId(
  processId: string,
  eventTypes?: string[],
): Promise<CivicEvent[]> {
  const rows = await readAll((from, to) => {
    let q = db().from("events").select<EventRow>("*").eq("process_id", processId);
    if (eventTypes?.length) q = q.in("event_type", eventTypes);
    return newestFirst(q).range(from, to);
  });
  return rows.map(rowToEvent);
}

/**
 * Every moderation action, newest first: the restricted `process.updated`
 * events that carry `data.moderation.action`. The moderation log's read; asks
 * the database for these rows only, all of them.
 */
export async function getModerationEvents(): Promise<CivicEvent[]> {
  const rows = await readAll((from, to) =>
    newestFirst(
      db()
        .from("events")
        .select<EventRow>("*")
        .eq("event_type", "civic.process.updated")
        .eq("meta->>visibility", "restricted")
        .not("data->moderation->>action", "is", null),
    ).range(from, to),
  );
  return rows.map(rowToEvent);
}

/** One public announcement of a published result: what feed health checks. */
export interface ResultPublication {
  process_id: string;
  timestamp: string;
  /** `data.process.type` as emitted, if any. */
  process_type: string | null;
}

/**
 * Every public `civic.process.result_published` event, newest first, as just
 * the three fields feed health reads. Restricted ones are left out: they are
 * never on the public feed.
 */
export async function getResultPublications(): Promise<ResultPublication[]> {
  const rows = await readAll((from, to) =>
    newestFirst(
      db()
        .from("events")
        .select<{ id: string; process_id: string | null; created_at: string; process_type: string | null }>(
          "id, process_id, created_at, process_type:data->process->>type",
        )
        .eq("event_type", "civic.process.result_published")
        .or("meta->>visibility.is.null,meta->>visibility.neq.restricted"),
    ).range(from, to),
  );
  return rows
    .filter((r) => r.process_id)
    .map((r) => ({ process_id: r.process_id!, timestamp: r.created_at, process_type: r.process_type }));
}

/** An event with the time its row was written (not part of the event itself). */
export type RecordedEvent = CivicEvent & { recorded_at: string };

/**
 * Every event RECORDED strictly after `sinceIso`, oldest first — by the
 * database's `recorded_at`, not the event's own timestamp, which may be
 * backdated (news sync; a vote closed after its deadline is stamped with the
 * deadline). Selecting by the stamp let a backdated event fall outside every
 * digest window; selecting by arrival cannot (Phase 5 part two, fix 6).
 *
 * Used by the digest cron. Never returns sample events: sample content does
 * not go out in a resident's digest.
 */
export async function getEventsSince(sinceIso: string): Promise<RecordedEvent[]> {
  // Paged: PostgREST answers at most 1,000 rows per request, and in ascending
  // order that silently dropped the NEWEST events once a window held more
  // (found 2026-10-07 on a local stack with 1,175 events in a day). Ordered
  // by recorded_at then id, so pages are stable.
  const rows = await readAll((from, to) =>
    db()
      .from("events")
      .select<EventRow & { recorded_at: string }>("*")
      .eq("is_sample", false)
      .gt("recorded_at", sinceIso)
      .order("recorded_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows.map((row) => ({ ...rowToEvent(row), recorded_at: row.recorded_at }));
}

// --- Paged reads (the AS2 collection endpoint) -----------------------------

/**
 * An opaque page cursor. Consumers MUST NOT parse it (Civic Activity Spec
 * v0.2 §6.1) — it is keyset state, not an offset, so pages stay stable as new
 * events arrive at the head of the log.
 */
export interface EventCursor {
  createdAt: string;
  id: string;
}

export interface EventPageQuery {
  /** Page size. Callers clamp before calling; the store trusts the number. */
  limit: number;
  cursor?: EventCursor | null;
  processId?: string;
  /** Internal event types to include. Empty/absent means "any type". */
  eventTypes?: string[];
  /** RFC 3339 — only events created strictly later than this. */
  since?: string;
  /** Leave restricted events out (non-admin callers), in the query. */
  excludeRestricted?: boolean;
  /**
   * Include sample events. Off for the public wire, which never carries
   * them; on for the hub's own feed, which shows them badged.
   */
  includeSample?: boolean;
}

export interface EventPage {
  events: CivicEvent[];
  /** Keyset state for the next (older) page, or null when this is the last. */
  nextCursor: EventCursor | null;
}

/**
 * Read one page of events, newest first, using keyset pagination on
 * (created_at, id). Both columns are needed: created_at alone is not unique
 * (events emitted inside one transaction share it), and skipping a tied row
 * would silently drop it from the feed.
 *
 * Fetches limit+1 rows so "is there a next page?" is answered without a
 * second query or a count.
 */
export async function getEventPage(query: EventPageQuery): Promise<EventPage> {
  let q = db().from("events").select<EventRow>("*");
  if (!query.includeSample) q = q.eq("is_sample", false);

  if (query.processId) q = q.eq("process_id", query.processId);
  if (query.eventTypes?.length) q = q.in("event_type", query.eventTypes);
  if (query.since) q = q.gt("created_at", query.since);
  // Spelled with the NULL branch, as in countEvents below: a null `meta` is
  // public.
  if (query.excludeRestricted) {
    q = q.or("meta->>visibility.is.null,meta->>visibility.neq.restricted");
  }
  if (query.cursor) {
    const { createdAt, id } = query.cursor;
    q = q.or(
      `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`,
    );
  }

  const rows = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];

  return {
    events: page.map(rowToEvent),
    nextCursor:
      hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
  };
}

export interface EventCountQuery {
  processId?: string;
  eventTypes?: string[];
  since?: string;
  /** Leave restricted events out of the count (non-admin callers). */
  excludeRestricted?: boolean;
  /** Process ids whose events are suppressed (archived / pending review). */
  excludeProcessIds?: string[];
}

/**
 * Count events matching the same filters a page read applies, so the
 * collection's `totalItems` describes exactly the sequence the caller can
 * page through. Counting the whole table instead would tell an unauthorized
 * caller that restricted activities exist — the disclosure the serving rule
 * (Civic Activity Spec v0.2 §5.2) exists to prevent.
 */
export async function countEvents(query: EventCountQuery = {}): Promise<number> {
  let q = db().from("events").count().eq("is_sample", false);
  if (query.processId) q = q.eq("process_id", query.processId);
  if (query.eventTypes?.length) q = q.in("event_type", query.eventTypes);
  if (query.since) q = q.gt("created_at", query.since);
  // Both exclusions spell the NULL branch out. `NOT (col = x)` and
  // `NOT (col IN (…))` evaluate to NULL — not true — for a NULL column, so
  // Postgres drops those rows from the count entirely. Page reads keep them
  // (rowToEvent defaults a null `meta` to public, and an event with no
  // process_id always passes the suppression filter), so the plain `.not()`
  // form would make totalItems smaller than the sequence it describes.
  if (query.excludeRestricted) {
    q = q.or("meta->>visibility.is.null,meta->>visibility.neq.restricted");
  }
  if (query.excludeProcessIds?.length) {
    q = q.or(
      `process_id.is.null,process_id.not.in.(${query.excludeProcessIds.join(",")})`,
    );
  }
  return await q;
}

/** Public wire only: a sample event is not public record, so it is not found. */
export async function getEventById(id: string): Promise<CivicEvent | null> {
  const data = await db()
    .from("events")
    .select<EventRow>("*")
    .eq("id", id)
    .eq("is_sample", false)
    .maybeSingle();
  return data ? rowToEvent(data) : null;
}

export async function getEventCount(): Promise<number> {
  return await db().from("events").count();
}

/**
 * Reset the store — dev/seed only.
 *
 * The append-only trigger uses `BEFORE UPDATE OR DELETE FOR EACH ROW` which
 * allows bulk truncation through a direct DELETE statement. To stay within
 * the Supabase client API, we use a filter that matches every row.
 */
export async function clearEvents(): Promise<void> {
  // The hub-token role may delete only sample events (20260926040000), so the
  // dev reset goes through the service role, and only with CIVIC_ALLOW_SEED.
  await forHubDevReset(currentHubId()).from("events").delete().neq("id", "");
}
