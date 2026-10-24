// Internal feed read model — GET /api/feed.
//
// This is the hub UI's own read layer, NOT part of the Civic Activity
// Specification's public surface. It serves the internal CivicEvent shape
// (`{ events, count, process_meta, next_cursor }`) that the React feed reads.
//
// It exists because /events became the spec's AS2 OrderedCollection in the
// v0.2 wire conversion. Rather than teach every UI component to read AS2 —
// which would couple the app's presentation to the federation format and put
// the classifier (shared/feedActivity.ts) on the wrong side of the seam — the
// old handler moved here verbatim. The spec surface and the app's read model
// are now separate concerns that can evolve independently.
//
// PAGED (2026-10-07). One request returns one page: `limit` items (default
// 25, at most 100) and `next_cursor`, which the next request passes back as
// `cursor`; null means there is nothing older. The page is assembled by
// services/feedPage.ts, which reads the log in batches and applies every
// visibility rule there. With neither `process_id` nor `event_type`, the page
// holds only events that become cards (the shared classifier), optionally of
// one `surface` (announcement | meeting_summary | activity): what the reader
// sees, and nothing else.

import { ValidationError } from "../errors/index.js";
import { route } from "../http/route.js";
import { buildFeedProcessMeta } from "../services/feedMeta.js";
import { isProcessHistoryServable } from "../services/processService.js";
import { resolveCaller } from "../middleware/auth.js";
import { can } from "../authz/canActor.js";
import { officialActorIds, redactEvent } from "../events/publicRedaction.js";
import {
  INVALID_CURSOR,
  decodeCursor,
  encodeCursor,
  firstQueryValue,
} from "../events/eventCursor.js";
import {
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  readFeedPage,
} from "../services/feedPage.js";
import type { ActivitySurface } from "../shared/feedActivity.js";

const SURFACES: readonly ActivitySurface[] = ["announcement", "meeting_summary", "activity"];

export const handleGetFeed = route(async (req, res) => {
  const processId = firstQueryValue(req.query.process_id);
  // Accept `type` as an alias for `event_type`: the hub's own API index
  // (app.ts) advertised `?type=`, but only `event_type` was read — making
  // the advertised filter a silent no-op. Support both.
  const eventType = firstQueryValue(req.query.event_type ?? req.query.type);
  const pretty = req.query.pretty === "true";

  const rawSurface = firstQueryValue(req.query.surface);
  if (rawSurface && !SURFACES.includes(rawSurface as ActivitySurface)) {
    throw new ValidationError(`Unknown surface "${rawSurface}"`);
  }
  const surface = rawSurface as ActivitySurface | undefined;
  const rawLimit = Number.parseInt(firstQueryValue(req.query.limit) ?? "", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), FEED_MAX_LIMIT)
    : FEED_DEFAULT_LIMIT;
  const cursor = decodeCursor(req.query.cursor);
  if (cursor === INVALID_CURSOR) {
    throw new ValidationError("Invalid cursor");
  }

  // Restricted events are admin-only. Default to public view; only
  // include restricted events when the caller authenticates as admin.
  const { user: caller, actor } = await resolveCaller(req);
  const isAdmin = await can(actor, "hub.see_as_admin");

  // A lookup of one process serves nothing while its page would not:
  // archived, pending review, or a switched-off plugin.
  const withheld = !!processId && !(await isProcessHistoryServable(processId, { hubSurface: true }));
  const page = withheld
    ? { events: [], nextCursor: null }
    : await readFeedPage({ limit, cursor, processId, eventType, surface, isAdmin });
  let events = page.events;

  // Account ids are hidden from everyone but a hub admin; names only from
  // the signed-out public (events/publicRedaction.ts, audit C2). The feed
  // UI reads neither, so residents see the same cards as before.
  if (!isAdmin) {
    const officials = await officialActorIds(events);
    const audience = caller ? "member" : "public";
    events = events.map((e) => redactEvent(e, officials, audience));
  }

  // Enrich the feed view with per-process card metadata, batched here
  // so the client needs no follow-up requests (and no pop-in — perf
  // pass phase 2, 2026-08-28). Only this page's processes. Skipped for
  // explicit per-process reads, which are lookups, not the feed.
  const process_meta = processId
    ? undefined
    : await buildFeedProcessMeta(events);
  // A moderator-removed announcement shows nothing; its meta says so.
  // The flag stays in process_meta for any client that reads it.
  if (process_meta) {
    events = events.filter((e) => !process_meta[e.process_id]?.removed);
  }

  const body = {
    events,
    count: events.length,
    process_meta,
    next_cursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
  };

  if (pretty) {
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(body, null, 2));
  } else {
    res.json(body);
  }
});
