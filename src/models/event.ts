// Civic Event model — aligned with Civic Event Spec v0.1
// Events are immutable records of actions taken within a civic hub.
//
// Events are the PRIMARY public interface of the hub.
// All external systems (feeds, dashboards, federation layers)
// should rely on events — not internal process APIs.

export interface EventSource {
  hub_id: string;
  hub_url: string;
}

export interface EventMeta {
  visibility: "public" | "restricted";
}

/**
 * Spec-compliant Civic Event.
 * All fields match Civic Event Spec v0.1 § 2–3.
 */
export interface CivicEvent {
  id: string;
  version: string;
  event_type: string;
  timestamp: string; // ISO 8601
  process_id: string;
  actor: string; // userId or DID
  jurisdiction: string;
  action_url: string;
  source: EventSource;
  dedupe_key?: string;
  data: Record<string, unknown>;
  meta: EventMeta;
  /**
   * Where this event's identifiers were minted (ADR-008), as stored on its
   * row by the database at insert. Absent on an event not yet stored (the
   * emission-path check), which serializes as the database will stamp it:
   * the hub's hostname now and the software namespace.
   */
  wire?: EventWire;
}

/**
 * The hostnames an event's identifiers are minted on, frozen at insert
 * (supabase/migrations/20261020000000_wire_origins.sql). A hub move changes
 * none of them, so nothing it has published changes id.
 */
export interface EventWire {
  /** The hub's hostname when the event was stored: the activity id, system and audience IRIs, generator.url. */
  hostname: string;
  /** The event's process's hostname at its creation: the process IRI. */
  process_hostname: string;
  /** The acting account's hostname at its creation: a participant's IRI. */
  actor_hostname: string;
  /** The `hub:` namespace IRI; null on rows from before 2026-10-20, which keep `{origin}/ns#`. */
  ns: string | null;
  /**
   * The acting person's own DID when the event was stored (events.wire_actor_did,
   * 20261023010000; ADR-011). Present only when they had set one AND the
   * event's type's disclosure policy serves an actor at all (never for
   * "anonymous"); absent otherwise, so an event without one is the same object
   * it always was. Redaction removes it wherever it hides the actor.
   */
  actor_did?: string;
}

/**
 * Input for emitEvent() — callers provide the minimum required fields.
 * The emitter fills in id, version, timestamp, source, action_url, and meta.
 *
 * Callers MAY override `action_url_path` when a process type's user-facing
 * URL differs from the default `/process/:id`. The path is prefixed with
 * the hub's UI base URL by the emitter. For example, civic.brief uses
 * `action_url_path: /brief/:id` so feed posts link to the public brief
 * page instead of the process detail view.
 */
export interface CreateEventInput {
  event_type: string;
  actor: string;
  process_id: string;
  jurisdiction: string;
  data: Record<string, unknown>;
  dedupe_key?: string;
  visibility?: "public" | "restricted";
  /**
   * Phase 3 (audit §2) — the canonical process type for this event, e.g.
   * "civic.vote". emitEvent stamps it into `data.process.type` so the shared
   * feed-worthiness classifier (shared/feedActivity.ts) can discriminate the
   * civic.process.<verb> family on ONE field instead of sniffing the shape of
   * `data`. Backwards-compatible and never clobbers an explicit type a caller
   * already set in `data.process`. Every civic.process.* emitter SHOULD pass
   * this; non-feed-worthy events carry it for backend uniformity but stay out
   * of the feed (the classifier is an allowlist, not driven by this field).
   */
  processType?: string;
  action_url_path?: string; // e.g. "/brief/abc123"; defaults to "/process/:id"
  /**
   * Slice 13 — explicit ISO 8601 timestamp override. Only used by sync
   * paths that want the event to reflect the real-world publication
   * time of the underlying content (e.g. floyd-news-sync uses Floyd's
   * RSS pubDate so synced announcements interleave chronologically with
   * other events in the feed instead of bunching at ingest time). Hand-
   * authored callers omit this and the emitter stamps `now`.
   */
  timestamp?: string;
}
