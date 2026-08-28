// civic.brief module — official responses (pure rules and projections)
//
// A published brief is a sealed record; the responsible government's side
// of the exchange arrives as OFFICIAL RESPONSES appended alongside it —
// public, append-only, each stamped with the office held at response
// time. This file holds every decision about them that does not touch a
// database: who may respond, when a brief can receive one, how the page
// derives its "Awaiting response" / "Responded" status, and which
// response anchors the (at most one per 24h) feed card.
//
// Storage lives in src/services/briefResponses.ts; the HTTP surface in
// briefController. Like the rest of this module, nothing here imports
// Express or Supabase, so the whole behaviour is coverable in tests/unit
// — the layer CI actually runs.

import type { BriefProcessState } from "./models.js";

/** Bounds for a response body — mirrors brief_responses_body_bounds. */
export const RESPONSE_BODY_MAX = 5000;

/** One stored response, as the service layer returns it. */
export interface BriefResponseRecord {
  id: string;
  brief_id: string;
  responder_id: string;
  /** Office snapshot taken at response time — renders forever as made. */
  official_type: string;
  official_title: string;
  body: string;
  feed_anchor: boolean;
  created_at: string; // ISO 8601
}

/** Public projection of one response (no account ids, no emails). */
export interface PublicBriefResponse {
  id: string;
  body: string;
  official_type: string;
  official_title: string;
  /** Resolved display name of the responder. */
  responder_name: string;
  created_at: string;
}

/** The page-level response status of a brief. */
export interface BriefResponseStatus {
  status: "awaiting" | "responded";
  /** Timestamp of the FIRST response — the date "Responded" renders. */
  responded_at: string | null;
  response_count: number;
}

/**
 * The respond gate, as one pure decision. The controller supplies what
 * the middleware and DB already resolved; this function owns the rules:
 *
 *   - only an account holding the official role may respond (residents
 *     and plain admins cannot — a response is a public act of an office,
 *     not a platform capability), and
 *   - only a PUBLISHED brief can receive one (the public cannot be
 *     responded to about a record it cannot see).
 *
 * Returns null when the response may proceed, or a { status, error }
 * the controller can send verbatim.
 */
export function respondGate(
  official: { type: string; title: string } | null,
  state: Pick<BriefProcessState, "publication_status"> | null,
): { status: number; error: string } | null {
  if (!official) {
    return {
      status: 403,
      error:
        "Only accounts holding an official role can post a response. " +
        "Ask a hub admin to designate your office.",
    };
  }
  if (!state) {
    return { status: 404, error: "Brief not found" };
  }
  if (state.publication_status !== "published") {
    return {
      status: 409,
      error: "Responses open once the brief is published.",
    };
  }
  return null;
}

/**
 * Validate and normalize a response body. Throws with a user-facing
 * message on an empty or oversized body.
 */
export function normalizeResponseBody(raw: unknown): string {
  const body = typeof raw === "string" ? raw.trim() : "";
  if (body.length === 0) {
    throw new Error("A response cannot be empty.");
  }
  if (body.length > RESPONSE_BODY_MAX) {
    throw new Error(
      `A response must be ${RESPONSE_BODY_MAX} characters or fewer.`,
    );
  }
  return body;
}

/**
 * Derive the page's status line from the stored responses.
 *
 * "Responded" anchors to the FIRST response and never moves — the status
 * records when the government first went on the record; later additions
 * carry their own dates on their own rows.
 */
export function responseStatus(
  responses: Array<Pick<BriefResponseRecord, "created_at">>,
): BriefResponseStatus {
  if (responses.length === 0) {
    return { status: "awaiting", responded_at: null, response_count: 0 };
  }
  // ISO 8601 sorts lexicographically, so min is the earliest.
  let earliest = responses[0]!.created_at;
  for (const r of responses) {
    if (r.created_at < earliest) earliest = r.created_at;
  }
  return {
    status: "responded",
    responded_at: earliest,
    response_count: responses.length,
  };
}

/** Rolling feed-collapse window: at most one anchored response per brief
 *  per 24 hours. Rolling rather than calendar-day so an 11:59pm response
 *  and a 12:01am follow-up cannot double-post. */
export const FEED_ANCHOR_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Decide whether a new response anchors a feed card, given the timestamp
 * of the brief's most recent PRIOR anchor (null when none exists).
 *
 * The rule keys on the last ANCHOR, not the last response: keying on any
 * response would let continuous conversation suppress cards forever,
 * while keying on the anchor guarantees a brief with ongoing responses
 * surfaces at most — and at least — once per window.
 *
 * The event log is never throttled by this — every response emits its
 * event; this flag only decides feed/digest visibility.
 */
export function isFeedAnchor(
  lastAnchorAt: string | null,
  now: Date,
): boolean {
  if (!lastAnchorAt) return true;
  const last = new Date(lastAnchorAt).getTime();
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= FEED_ANCHOR_WINDOW_MS;
}

/**
 * Project stored responses for the public read model, oldest first (the
 * section reads as correspondence, in the order it happened). The
 * responder's account id stays server-side; the display name is resolved
 * by the service layer.
 */
export function toPublicResponses(
  records: BriefResponseRecord[],
  nameOf: (responderId: string) => string,
): PublicBriefResponse[] {
  return [...records]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((r) => ({
      id: r.id,
      body: r.body,
      official_type: r.official_type,
      official_title: r.official_title,
      responder_name: nameOf(r.responder_id),
      created_at: r.created_at,
    }));
}

/** Excerpt used on the feed/digest card for an anchored response. */
export function responseExcerpt(body: string, max = 200): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}
