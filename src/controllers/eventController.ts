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

import { NotFoundError, ValidationError } from "../errors/index.js";
import { route } from "../http/route.js";
import { Request } from "express";
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
  activityIdOf,
  activityTypeIndex,
} from "../events/activitySerializer.js";
import { resolveCaller, resolveCallerIsAdmin } from "../middleware/auth.js";
import { can } from "../authz/canActor.js";
import { getNonPublicProcessIds, isProcessHistoryServable, processRemovalRecord } from "../services/processService.js";
import { REMOVAL_EVENT_TYPES } from "../processes/descriptor.js";
import {
  officialActorIds,
  toRedactedActivity,
  type WireAudience,
} from "../events/publicRedaction.js";
import { baseUrl, uiBaseUrl } from "../utils/baseUrl.js";
import {
  INVALID_CURSOR,
  decodeCursor,
  encodeCursor,
  firstQueryValue,
} from "../events/eventCursor.js";

/** Civic Activity Spec §6.1 — the collection's media type. */
const ACTIVITY_JSON = "application/activity+json; charset=utf-8";

/**
 * The equivalent JSON-LD form. §6.1 SHOULDs that a space accept and honor
 * `Accept: application/ld+json; profile="https://www.w3.org/ns/activitystreams"`,
 * which is how JSON-LD-native tooling asks for the same document.
 */
const LD_JSON = 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"; charset=utf-8';

/**
 * Pick the response media type from the caller's `Accept`.
 *
 * The body is byte-identical either way — AS2 IS JSON-LD, so this is a
 * labelling decision, not a serialization one. Anything that does not ask for
 * ld+json gets `application/activity+json`, which is what the fediverse sends
 * and what §6.1 names as the default.
 */
function negotiateActivityType(req: Request): string {
  const accept = req.headers.accept;
  if (typeof accept === "string" && accept.toLowerCase().includes("application/ld+json")) {
    return LD_JSON;
  }
  return ACTIVITY_JSON;
}

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
  return resolveCallerIsAdmin(req);
}

/**
 * One token resolution for both serving decisions on this surface:
 * restricted-event visibility (admin) and redaction (events/publicRedaction):
 * account ids are hidden from everyone but hub admins, names only from the
 * signed-out public (audit C2, 2026-10-11).
 */
async function callerView(
  req: Request,
): Promise<{ isAdmin: boolean; audience: WireAudience }> {
  const { user, actor } = await resolveCaller(req);
  const isAdmin = await can(actor, "hub.see_as_admin");
  return {
    isAdmin,
    audience: isAdmin ? "admin" : user ? "member" : "public",
  };
}

// --- GET /events -----------------------------------------------------------

export const handleGetActivityCollection = route(async (req, res) => {
  const filters = readFilters(req);
  const paged = req.query.page === "true" || typeof req.query.cursor === "string";

  if (!paged) {
    res.setHeader("Content-Type", negotiateActivityType(req));
    res.json(await buildCollection(req, filters));
    return;
  }

  const cursor = decodeCursor(req.query.cursor);
  if (cursor === INVALID_CURSOR) {
    throw new ValidationError("Invalid cursor");
  }

  res.setHeader("Content-Type", negotiateActivityType(req));
  res.json(await buildPage(req, filters, cursor));
});

// --- GET /activities/:id ---------------------------------------------------

export const handleGetActivity = route(async (req, res) => {
  const id = String(req.params.id ?? "");
  const event = await getEventById(id);
  // Spec §5.2: a restricted activity is indistinguishable from an absent
  // one. Same 404, same body — an unauthorized caller learns nothing.
  if (!event) {
    throw new NotFoundError("Activity not found");
  }
  const caller = await callerView(req);
  if (event.meta?.visibility === "restricted" && !caller.isAdmin) {
    throw new NotFoundError("Activity not found");
  }
  // An archived or pending-review process serves no history, by id or
  // otherwise: the same rule as its page, for everyone — with one trace
  // (Architecture 3, ADR-010): when an admin took a PUBLISHED process down,
  // each activity id answers a Tombstone keeping the id and the removal time
  // and nothing else, and the removal's own Delete/Undo keep serving. A
  // process that was never published keeps its silent 404.
  if (event.process_id && !(await isProcessHistoryServable(event.process_id, { hubSurface: false }))) {
    if (!REMOVAL_EVENT_TYPES.has(event.event_type)) {
      const removal = await processRemovalRecord(event.process_id);
      if (removal) {
        res.status(410);
        res.setHeader("Content-Type", negotiateActivityType(req));
        res.json({
          "@context": AS2_CONTEXT,
          id: activityIdOf(event),
          type: "Tombstone",
          deleted: removal.archivedAt,
        });
        return;
      }
      throw new NotFoundError("Activity not found");
    }
  }

  res.setHeader("Content-Type", negotiateActivityType(req));
  if (caller.audience === "admin") {
    res.json(toActivity(event));
  } else {
    res.json(toRedactedActivity(event, await officialActorIds([event]), caller.audience));
  }
});

// --- GET /audiences/:name ----------------------------------------------------

/**
 * The audience collection restricted activities are addressed to
 * (Architecture 3; Adam, 2026-10-21, Q4). Dereferencing it tells a reader
 * what the audience is and who may read activities addressed to it; its
 * items are never served, to anyone — the serving rule (spec §5.2) is what
 * enforces the audience, and listing members or counts would itself be a
 * disclosure. `admins` is the only audience the hub mints (the serializer's
 * audienceOf).
 */
export const handleGetAudience = route((req, res) => {
  if (String(req.params.name ?? "") !== "admins") {
    throw new NotFoundError("Audience not found");
  }
  res.setHeader("Content-Type", negotiateActivityType(req));
  res.json({
    "@context": AS2_CONTEXT,
    id: `${baseUrl()}/audiences/admins`,
    type: "Collection",
    name: "Hub administrators",
    summary:
      "Activities addressed to this collection are readable only by this hub's administrators. Its items are not served.",
  });
});

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

/**
 * A withheld process's one public trace (Architecture 3): when its removal
 * was announced, its collection serves the removal events and nothing else —
 * the event types the lookup may still match, or null for everything.
 */
async function withheldEventTypes(
  filters: Filters,
  withheld: boolean,
): Promise<string[] | null> {
  if (!withheld) return filters.eventTypes ?? null;
  if (!filters.processId || !(await processRemovalRecord(filters.processId))) return [];
  const removal = [...REMOVAL_EVENT_TYPES];
  return filters.eventTypes ? removal.filter((t) => filters.eventTypes!.includes(t)) : removal;
}

async function buildCollection(
  req: Request,
  filters: Filters,
): Promise<Record<string, unknown>> {
  const { isAdmin } = await callerView(req);
  const hidden = filters.processId
    ? new Set<string>()
    : await getNonPublicProcessIds();
  // A lookup of one process that is archived or pending review answers as
  // an empty collection, the same as a process with no activity (§5.2) —
  // unless its removal was announced: then its Delete (and any Undo) still
  // serve, the trace the removal leaves (Architecture 3, ADR-010).
  const withheld = !!filters.processId && !(await isProcessHistoryServable(filters.processId, { hubSurface: false }));
  const servedTypes = await withheldEventTypes(filters, withheld);

  // `totalItems` counts only what THIS caller can page through, so it never
  // signals the existence of activities the serving rule withholds. Skipped
  // when the suppression list is too large to express as a filter, and when
  // the type filter matched nothing (the answer is then trivially zero).
  const countable = hidden.size <= MAX_LIMIT;
  const nothingServed = filters.unmatchedType || (withheld && servedTypes !== null && servedTypes.length === 0);
  const totalItems = nothingServed
    ? 0
    : countable
      ? await countEvents({
          processId: filters.processId,
          eventTypes: servedTypes ?? undefined,
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
  const { isAdmin, audience } = await callerView(req);
  let events: Awaited<ReturnType<typeof getEventPage>>["events"] = [];
  let nextCursor: EventCursor | null = null;

  const withheld = !!filters.processId && !(await isProcessHistoryServable(filters.processId, { hubSurface: false }));
  const servedTypes = await withheldEventTypes(filters, withheld);
  if (!filters.unmatchedType && !(withheld && servedTypes !== null && servedTypes.length === 0)) {
    const page = await getEventPage({
      limit: filters.limit,
      cursor,
      processId: filters.processId,
      eventTypes: servedTypes ?? undefined,
      since: filters.since,
    });
    events = page.events;
    nextCursor = page.nextCursor;

    // Visibility, unchanged from the v0.1 feed:
    //  - events of archived / pending-review processes are suppressed for
    //    everyone (admins included) so removed items leave no ghost cards —
    //    except the removal's own Delete/Undo, the trace an announced
    //    removal leaves on the wire (Architecture 3, ADR-010); a lookup of
    //    one such process is withheld whole, above, down to that trace;
    //  - restricted events are admin-only.
    // Both filter the page AFTER the keyset read, so a page may carry fewer
    // than `limit` items while `next` still points at more. That is a valid
    // page (§6.1) and is what keeps "you may not see this" unsignalled.
    if (!filters.processId) {
      const hidden = await getNonPublicProcessIds();
      if (hidden.size > 0) {
        events = events.filter(
          (e) => !e.process_id || !hidden.has(e.process_id) || REMOVAL_EVENT_TYPES.has(e.event_type),
        );
      }
    }
    if (!isAdmin) {
      events = events.filter((e) => e.meta?.visibility !== "restricted");
    }
  }

  // Everyone but an admin gets resident account ids rewritten to
  // per-process opaque IRIs; the signed-out public also loses name-shaped
  // payload fields. Admins get the canonical documents, unchanged.
  const officials =
    audience === "admin" ? null : await officialActorIds(events);

  const page: Record<string, unknown> = {
    "@context": [AS2_CONTEXT, CIVIC_CONTEXT],
    id: pageUrl(filters, cursor),
    type: "OrderedCollectionPage",
    partOf: collectionUrl(filters),
    orderedItems: officials && audience !== "admin"
      ? events.map((e) => toRedactedActivity(e, officials, audience))
      : events.map((e) => toActivity(e)),
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

function isKnownEventType(value: string): boolean {
  return Object.values(activityTypeIndex()).some((types) =>
    types.includes(value),
  );
}
