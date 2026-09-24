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
  /**
   * IGNORED. `source.hub_id` is the protocol identity of the hub in scope
   * (`hubs.protocol_hub_id`), stamped by emitEvent. Callers still pass this —
   * usually `process.hubId`, which is the TENANT id since 2026-09-24 — and it
   * is removed with the events conversion to forHub().
   */
  hub_id?: string;
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
