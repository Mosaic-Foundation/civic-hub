// Activity collection endpoints — the hub's public wire surface.
//
//   GET /events           → AS2 OrderedCollection (+ OrderedCollectionPage)
//   GET /activities/:id   → one serialized activity
//
// Both serve Civic Activities per the Civic Activity Specification v0.2
// (civic-social-docs/specs/civic-activity-spec.md §6). Documents are produced
// at read time by events/activitySerializer.ts from the internal event log —
// nothing AS2-shaped is stored.
//
// The hub UI does NOT read this surface; it reads GET /api/feed (see
// feedController.ts), which still serves the internal event shape.

import { Request, Response } from "express";
import {
  countEvents,
  getEventById,
  getEventPage,
  type EventCursor,
} from "../events/eventStore.js";
import {
  AS2_CONTEXT,
  CIVIC_CONTEXT,
  toActivity,
  activityTypeIndex,
} from "../events/activitySerializer.js";
import { getUserFromToken } from "../modules/civic.auth/index.js";
import { isAdminEmail } from "../middleware/auth.js";
import { getNonPublicProcessIds } from "../services/processService.js";
import { baseUrl, uiBaseUrl } from "../utils/baseUrl.js";

/** Civic Activity Spec §6.1 — the collection's media type. */
const ACTIVITY_JSON = "application/activity+json; charset=utf-8";

/** Spec §6.2 — `limit` defaults to 50, maxes at 200, and CLAMPS (never rejects). */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Slice 11 — events with `meta.visibility === "restricted"` are
 * moderation audit events. They MUST NOT appear on the public event
 * feed. Admins, however, do see them so they can audit moderation
 * actions externally if needed. We do a best-effort token check; any
 * failure short of an admin-positive identification falls back to the
 * public view.
 */
export async function callerIsAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  if (!token) return false;
  try {
    const user = await getUserFromToken(token);
    if (!user) return false;
    return isAdminEmail(user.email);
  } catch {
    return false;
  }
}

// --- GET /events -----------------------------------------------------------

export async function handleGetActivityCollection(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const filters = readFilters(req);
    const paged = req.query.page === "true" || typeof req.query.cursor === "string";

    if (!paged) {
      res.setHeader("Content-Type", ACTIVITY_JSON);
      res.json(await buildCollection(req, filters));
      return;
    }

    const cursor = decodeCursor(req.query.cursor);
    if (cursor === INVALID_CURSOR) {
      res.status(400).json({ error: "Invalid cursor" });
      return;
    }

    res.setHeader("Content-Type", ACTIVITY_JSON);
    res.json(await buildPage(req, filters, cursor));
  } catch (err) {
    // A stored event that cannot be serialized lands here. That is a loud
    // failure by design (see activitySerializer.ts): new events are validated
    // at the emission path, so this can only mean the log holds a row from
    // before its type was mapped — which must be fixed, not papered over.
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

// --- GET /activities/:id ---------------------------------------------------

export async function handleGetActivity(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const id = String(req.params.id ?? "");
    const event = await getEventById(id);
    // Spec §5.2: a restricted activity is indistinguishable from an absent
    // one. Same 404, same body — an unauthorized caller learns nothing.
    if (!event) {
      res.status(404).json({ error: "Activity not found" });
      return;
    }
    if (event.meta?.visibility === "restricted" && !(await callerIsAdmin(req))) {
      res.status(404).json({ error: "Activity not found" });
      return;
    }

    res.setHeader("Content-Type", ACTIVITY_JSON);
    res.json(toActivity(event));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

// --- Collection assembly ---------------------------------------------------

interface Filters {
  /** Bare process id, from a `context` process IRI or a bare id. */
  processId?: string;
  /** The `type` parameter verbatim, for round-tripping into page URLs. */
  type?: string;
  /** Internal event types the `type` filter resolves to. */
  eventTypes?: string[];
  /** True when `type` was given but matches nothing this hub can emit. */
  unmatchedType: boolean;
  since?: string;
  limit: number;
}

/**
 * Spec §6.2 query parameters. Unknown or unusable values never raise: a filter
 * that matches nothing yields an empty page, which is a valid response and the
 * only one that keeps an unauthorized caller and an empty result
 * indistinguishable (§5.2).
 */
function readFilters(req: Request): Filters {
  const context = firstQueryValue(req.query.context);
  const type = firstQueryValue(req.query.type);
  const since = firstQueryValue(req.query.since);
  const rawLimit = Number.parseInt(firstQueryValue(req.query.limit) ?? "", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const filters: Filters = { limit, unmatchedType: false };
  if (context) filters.processId = processIdFromContext(context);
  if (since) filters.since = since;
  if (type) {
    filters.type = type;
    const index = activityTypeIndex();
    // `type` names an AS2 activity type (`Create`, `Announce`, `civic:End`),
    // which several internal event types can share. An internal event type is
    // also accepted, mirroring `context`'s IRI-or-bare-id leniency.
    const eventTypes = index[type];
    if (eventTypes) filters.eventTypes = eventTypes;
    else if (isKnownEventType(type)) filters.eventTypes = [type];
    else filters.unmatchedType = true;
  }
  return filters;
}

async function buildCollection(
  req: Request,
  filters: Filters,
): Promise<Record<string, unknown>> {
  const isAdmin = await callerIsAdmin(req);
  const hidden = filters.processId
    ? new Set<string>()
    : await getNonPublicProcessIds();

  // `totalItems` counts only what THIS caller can page through, so it never
  // signals the existence of activities the serving rule withholds. Skipped
  // when the suppression list is too large to express as a filter, and when
  // the type filter matched nothing (the answer is then trivially zero).
  const countable = hidden.size <= MAX_LIMIT;
  const totalItems = filters.unmatchedType
    ? 0
    : countable
      ? await countEvents({
          processId: filters.processId,
          eventTypes: filters.eventTypes,
          since: filters.since,
          excludeRestricted: !isAdmin,
          excludeProcessIds: [...hidden],
        })
      : null;

  const collection: Record<string, unknown> = {
    "@context": AS2_CONTEXT,
    id: collectionUrl(filters),
    type: "OrderedCollection",
  };
  if (totalItems !== null) collection.totalItems = totalItems;
  collection.first = pageUrl(filters, null);
  return collection;
}

async function buildPage(
  req: Request,
  filters: Filters,
  cursor: EventCursor | null,
): Promise<Record<string, unknown>> {
  const isAdmin = await callerIsAdmin(req);
  let events: Awaited<ReturnType<typeof getEventPage>>["events"] = [];
  let nextCursor: EventCursor | null = null;

  if (!filters.unmatchedType) {
    const page = await getEventPage({
      limit: filters.limit,
      cursor,
      processId: filters.processId,
      eventTypes: filters.eventTypes,
      since: filters.since,
    });
    events = page.events;
    nextCursor = page.nextCursor;

    // Visibility, unchanged from the v0.1 feed:
    //  - events of archived / pending-review processes are suppressed for
    //    everyone (admins included) so removed items leave no ghost cards;
    //    skipped when the caller asked for one specific process, which is an
    //    explicit lookup rather than the feed;
    //  - restricted events are admin-only.
    // Both filter the page AFTER the keyset read, so a page may carry fewer
    // than `limit` items while `next` still points at more. That is a valid
    // page (§6.1) and is what keeps "you may not see this" unsignalled.
    if (!filters.processId) {
      const hidden = await getNonPublicProcessIds();
      if (hidden.size > 0) {
        events = events.filter(
          (e) => !e.process_id || !hidden.has(e.process_id),
        );
      }
    }
    if (!isAdmin) {
      events = events.filter((e) => e.meta?.visibility !== "restricted");
    }
  }

  const page: Record<string, unknown> = {
    "@context": [AS2_CONTEXT, CIVIC_CONTEXT],
    id: pageUrl(filters, cursor),
    type: "OrderedCollectionPage",
    partOf: collectionUrl(filters),
    orderedItems: events.map(toActivity),
  };
  // `next` is absent on the last page (§6.1) and carries the request's filter
  // set forward so the sequence a consumer walks stays the one it asked for.
  if (nextCursor) page.next = pageUrl(filters, nextCursor);
  return page;
}

// --- URLs and cursors ------------------------------------------------------

function collectionUrl(filters: Filters): string {
  return `${baseUrl()}/events${filterQuery(filters)}`;
}

function pageUrl(filters: Filters, cursor: EventCursor | null): string {
  const params = filterParams(filters);
  params.set("page", "true");
  if (cursor) params.set("cursor", encodeCursor(cursor));
  return `${baseUrl()}/events?${params.toString()}`;
}

/**
 * Filters in a fixed order, so a given request always produces the same URLs
 * (page ids and `next` links are compared by consumers).
 */
function filterParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.processId) {
    params.set("context", `${uiBaseUrl()}/process/${filters.processId}`);
  }
  if (filters.type) params.set("type", filters.type);
  if (filters.since) params.set("since", filters.since);
  if (filters.limit !== DEFAULT_LIMIT) params.set("limit", String(filters.limit));
  return params;
}

function filterQuery(filters: Filters): string {
  const query = filterParams(filters).toString();
  return query ? `?${query}` : "";
}

/**
 * `context` accepts a process IRI (what the activities themselves carry) or a
 * bare process id (what the hub's own tooling has to hand). Anything else is
 * treated as a bare id and simply matches nothing.
 */
function processIdFromContext(context: string): string {
  const marker = "/process/";
  const at = context.lastIndexOf(marker);
  const id = at >= 0 ? context.slice(at + marker.length) : context;
  return id.split(/[?#]/)[0];
}

const INVALID_CURSOR = Symbol("invalid-cursor");

/** Cursors are opaque to consumers (§6.1): base64url of `created_at|id`. */
function encodeCursor(cursor: EventCursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, "utf8").toString(
    "base64url",
  );
}

function decodeCursor(
  raw: unknown,
): EventCursor | null | typeof INVALID_CURSOR {
  const value = firstQueryValue(raw);
  if (!value) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return INVALID_CURSOR;
  }
  const separator = decoded.lastIndexOf("|");
  if (separator <= 0) return INVALID_CURSOR;
  const createdAt = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (!createdAt || !id) return INVALID_CURSOR;
  return { createdAt, id };
}

function firstQueryValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) return firstQueryValue(value[0]);
  return undefined;
}

function isKnownEventType(value: string): boolean {
  return Object.values(activityTypeIndex()).some((types) =>
    types.includes(value),
  );
}
