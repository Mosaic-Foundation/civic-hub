// Internal feed read model — GET /api/feed.
//
// This is the hub UI's own read layer, NOT part of the Civic Activity
// Specification's public surface. It serves the internal CivicEvent shape
// (`{ events, count }`) that the React feed, its filters and the email digest
// preview already consume, unchanged.
//
// It exists because /events became the spec's AS2 OrderedCollection in the
// v0.2 wire conversion. Rather than teach every UI component to read AS2 —
// which would couple the app's presentation to the federation format and put
// the classifier (shared/feedActivity.ts) on the wrong side of the seam — the
// old handler moved here verbatim. The spec surface and the app's read model
// are now separate concerns that can evolve independently.

import { Request, Response } from "express";
import { getAllEvents, getEventsByProcessId } from "../events/eventStore.js";
import { getNonPublicProcessIds } from "../services/processService.js";
import { buildFeedProcessMeta } from "../services/feedMeta.js";
import { isAdminEmail, resolveCallerUser } from "../middleware/auth.js";
import {
  officialActorIds,
  redactEventForPublic,
} from "../events/publicRedaction.js";

export async function handleGetFeed(
  req: Request,
  res: Response,
): Promise<void> {
  const processId = req.query.process_id as string | undefined;
  // Accept `type` as an alias for `event_type`: the hub's own API index
  // (app.ts) advertised `?type=`, but only `event_type` was read — making
  // the advertised filter a silent no-op. Support both.
  const eventType = (req.query.event_type ?? req.query.type) as
    | string
    | undefined;
  const pretty = req.query.pretty === "true";

  try {
    let events = processId
      ? await getEventsByProcessId(processId)
      : await getAllEvents();

    // Suppress events belonging to archived / pending-review processes so a
    // removed item leaves no ghost feed cards. Applies to everyone (admins
    // included) — archived content is reachable via the admin Archived view,
    // never the feed. Events with no process_id (rare) always pass through.
    // Skipped when the caller asked for a specific process_id (that read is an
    // explicit lookup, not the feed).
    if (!processId) {
      const hidden = await getNonPublicProcessIds();
      if (hidden.size > 0) {
        events = events.filter(
          (e) => !e.process_id || !hidden.has(e.process_id),
        );
      }
    }

    // Restricted events are admin-only. Default to public view; only
    // include restricted events when the caller authenticates as admin.
    const caller = await resolveCallerUser(req);
    const isAdmin = !!caller && isAdminEmail(caller.email);
    if (!isAdmin) {
      events = events.filter((e) => e.meta?.visibility !== "restricted");
    }

    // Public anonymity (2026-08-31): with no valid session at all, resident
    // actors are rewritten to per-process opaque tokens and name-shaped
    // payload fields are scrubbed before the events leave the API. Any
    // signed-in caller (member or admin) gets the events unchanged.
    if (!caller) {
      const officials = await officialActorIds(events);
      events = events.map((e) => redactEventForPublic(e, officials));
    }

    // Collapse superseded publications: one card per published process.
    //
    // A process can legitimately be published more than once. The
    // meeting-summary upgrade pass re-summarizes an agenda-based summary when
    // official minutes appear, which sends it back through review, and
    // re-approval emits a second `result_published`. Both events are true
    // history and the log is append-only — but the feed is a projection of
    // current state, and rendering both leaves a stale card pointing at
    // content that has since been replaced. Keep the newest.
    //
    // Scoped to result_published deliberately: repeated comments, votes and
    // updates are distinct occurrences and must each keep their own card.
    if (!processId) {
      const newestPublication = new Map<string, string>();
      for (const e of events) {
        if (e.event_type !== "civic.process.result_published" || !e.process_id) {
          continue;
        }
        const seen = newestPublication.get(e.process_id);
        if (!seen || e.timestamp > seen) {
          newestPublication.set(e.process_id, e.timestamp);
        }
      }
      if (newestPublication.size > 0) {
        events = events.filter(
          (e) =>
            e.event_type !== "civic.process.result_published" ||
            !e.process_id ||
            newestPublication.get(e.process_id) === e.timestamp,
        );
      }
    }

    // Optional: further filter by event type (combinable with process_id)
    if (eventType) {
      events = events.filter((e) => e.event_type === eventType);
    }

    // Enrich the feed view with per-process card metadata, batched here
    // so the client needs no follow-up requests (and no pop-in — perf
    // pass phase 2, 2026-08-28). Skipped for explicit per-process reads,
    // which are lookups, not the feed.
    const process_meta = processId
      ? undefined
      : await buildFeedProcessMeta(events);

    const body = { events, count: events.length, process_meta };

    if (pretty) {
      res.setHeader("Content-Type", "application/json");
      res.send(JSON.stringify(body, null, 2));
    } else {
      res.json(body);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
