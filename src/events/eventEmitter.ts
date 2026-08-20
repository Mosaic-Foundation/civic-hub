// Centralized event creation and emission.
//
// All events flow through here — the single emission path the Civic Activity
// Specification v0.2 (§7.1) requires, so no observable state change bypasses
// the activity stream. The event stored here is the hub's INTERNAL model; its
// AS2 wire form is produced at the edge by events/activitySerializer.ts and
// validated below before anything is written.
//
// Events are the PRIMARY public interface of the hub. All external systems
// should rely on events, not internal process APIs.

import { CivicEvent, CreateEventInput } from "../models/event.js";
import { appendEvent } from "./eventStore.js";
import { validateForEmission } from "./activitySerializer.js";
import { generateId } from "../utils/id.js";
import { baseUrl, uiBaseUrl } from "../utils/baseUrl.js";

/**
 * Create and durably store a spec-compliant civic event.
 * This is the ONLY place events should be created.
 *
 * Returns the stored event. Throws if the DB write fails — callers should
 * surface the error (events are the source of truth; never silently drop).
 */
export async function emitEvent(input: CreateEventInput): Promise<CivicEvent> {
  const hub = baseUrl();
  const ui = uiBaseUrl();
  // action_url is the user-facing UI URL (per Civic Event Spec §3 — "link to
  // take action"). Defaults to /process/:id; callers can override via
  // action_url_path when a process type has a distinct public page.
  //
  // Synced-content callers (e.g. floyd-news-sync) can pass a fully-qualified
  // external URL via action_url_path — when the value starts with http(s)://
  // it's used verbatim as the action_url instead of being prefixed with the
  // hub's UI base. This lets a feed card click route directly to an
  // external source (Floyd's news post, etc.) rather than an internal page.
  const path = input.action_url_path ?? `/process/${input.process_id}`;
  const isAbsolute = /^https?:\/\//i.test(path);
  // Phase 3 (audit §2) — stamp the canonical process type into
  // `data.process.type` so the shared classifier can discriminate the
  // civic.process.<verb> family on one field. Merge-safe: never overwrites a
  // type a caller already set in `data.process`, and preserves any other
  // fields already on `data.process` (vote events carry method/options there).
  const data = stampProcessType(input.data, input.processType);
  const event: CivicEvent = {
    id: generateId("evt"),
    version: "1.0",
    event_type: input.event_type,
    // Sync paths (e.g. floyd-news-sync) override timestamp with the
    // underlying content's real-world publication time so the feed
    // displays synced items in their natural chronological position
    // instead of clustering them at ingest time. All other callers
    // omit input.timestamp and stamp "now".
    timestamp: input.timestamp ?? new Date().toISOString(),
    process_id: input.process_id,
    actor: input.actor,
    jurisdiction: input.jurisdiction,
    action_url: isAbsolute ? path : `${ui}${path}`,
    source: {
      hub_id: input.hub_id,
      hub_url: hub,
    },
    data,
    meta: {
      visibility: input.visibility ?? "public",
    },
  };

  if (input.dedupe_key) {
    event.dedupe_key = input.dedupe_key;
  }

  // Validate at the emission path (Civic Activity Spec v0.2 §7.2): the event
  // is projected onto its AS2 wire form BEFORE it is stored. An event that
  // cannot be serialized — an event_type with no mapping, a malformed
  // timestamp, a missing actor — must not enter the append-only log, because
  // the log is permanent and /events would then be unable to serve it. The
  // serialized document is deliberately discarded: the internal event is the
  // source of truth and the wire is a projection of it, recomputed on read.
  try {
    validateForEmission(event);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `emitEvent: refusing to store an event that cannot be serialized as a ` +
        `Civic Activity — ${reason}`,
      { cause: err },
    );
  }

  await appendEvent(event);

  console.log(`[event] ${event.event_type} by ${event.actor} (${event.id})`);

  return event;
}

/**
 * Merge `processType` into `data.process.type` without clobbering an existing
 * type or other fields already on `data.process`. Returns the input unchanged
 * when no processType is supplied (or it's already present) so callers that
 * don't set it pay nothing.
 */
function stampProcessType(
  data: Record<string, unknown>,
  processType: string | undefined,
): Record<string, unknown> {
  if (!processType) return data;
  const existing = data.process as Record<string, unknown> | undefined;
  if (existing && typeof existing.type === "string") return data;
  return {
    ...data,
    process: { ...(existing ?? {}), type: processType },
  };
}
