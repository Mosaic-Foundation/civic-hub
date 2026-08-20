// Append-only event store — backed by Postgres (events table).
//
// Events are the PRIMARY public interface of the hub.
// External systems should consume from this store (via /events),
// not from internal process APIs.
//
// The schema enforces append-only at the database level via a trigger
// that blocks UPDATE/DELETE on the events table. clearEvents() is the
// only DELETE path, and it is gated to dev-only callers.

import { getDb } from "../db/client.js";
import { CivicEvent } from "../models/event.js";

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

function eventToRow(event: CivicEvent): Omit<EventRow, "created_at"> {
  return {
    id: event.id,
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
  const { error } = await getDb().from("events").insert(eventToRow(event));
  if (error) {
    // Events are the source of truth; never silently drop.
    throw new Error(`EventStore: failed to append event: ${error.message}`);
  }
}

export async function getAllEvents(): Promise<CivicEvent[]> {
  const { data, error } = await getDb()
    .from("events")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`EventStore: ${error.message}`);
  return (data ?? []).map(rowToEvent);
}

export async function getEventsByProcessId(
  processId: string,
): Promise<CivicEvent[]> {
  const { data, error } = await getDb()
    .from("events")
    .select("*")
    .eq("process_id", processId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`EventStore: ${error.message}`);
  return (data ?? []).map(rowToEvent);
}

/**
 * Return all events strictly newer than `sinceIso`. Ordered ascending by
 * timestamp so callers iterating per-user digest windows can stop early
 * once they've walked past a user's cursor.
 *
 * Used by the Slice 5 digest cron endpoint.
 */
export async function getEventsSince(sinceIso: string): Promise<CivicEvent[]> {
  const { data, error } = await getDb()
    .from("events")
    .select("*")
    .gt("created_at", sinceIso)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`EventStore: ${error.message}`);
  return (data ?? []).map(rowToEvent);
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
  let q = getDb().from("events").select("*");

  if (query.processId) q = q.eq("process_id", query.processId);
  if (query.eventTypes?.length) q = q.in("event_type", query.eventTypes);
  if (query.since) q = q.gt("created_at", query.since);
  if (query.cursor) {
    const { createdAt, id } = query.cursor;
    q = q.or(
      `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`,
    );
  }

  const { data, error } = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(query.limit + 1);
  if (error) throw new Error(`EventStore: ${error.message}`);

  const rows = (data ?? []) as EventRow[];
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
  let q = getDb().from("events").select("*", { count: "exact", head: true });
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
  const { count, error } = await q;
  if (error) throw new Error(`EventStore: ${error.message}`);
  return count ?? 0;
}

export async function getEventById(id: string): Promise<CivicEvent | null> {
  const { data, error } = await getDb()
    .from("events")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`EventStore: ${error.message}`);
  return data ? rowToEvent(data as EventRow) : null;
}

export async function getEventCount(): Promise<number> {
  const { count, error } = await getDb()
    .from("events")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`EventStore: ${error.message}`);
  return count ?? 0;
}

/**
 * Reset the store — dev/seed only.
 *
 * The append-only trigger uses `BEFORE UPDATE OR DELETE FOR EACH ROW` which
 * allows bulk truncation through a direct DELETE statement. To stay within
 * the Supabase client API, we use a filter that matches every row.
 */
export async function clearEvents(): Promise<void> {
  const { error } = await getDb().from("events").delete().neq("id", "");
  if (error) {
    // If the append-only trigger is firing (shouldn't — it's BEFORE UPDATE/DELETE
    // on individual rows, not bulk), surface the error clearly.
    throw new Error(`EventStore: failed to clear events: ${error.message}`);
  }
}
