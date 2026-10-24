// Wire redaction — account ids hidden from everyone but hub admins, names
// hidden from signed-out visitors. Serves GET /events (AS2),
// GET /activities/:id and GET /api/feed.
//
// The stored event log is untouched (it is the append-only source of
// truth); this module redacts AT SERVE TIME. Account ids are replaced for
// everyone but admins (below). Names are governed by the process's DECLARED
// disclosure policy (manifest.disclosure; Architecture 3, ADR-010; Adam,
// 2026-10-21) rather than by whether the reader signed in: "anonymous" types
// scrub name-shaped fields for members too, "members" types keep today's
// member/public split (names to members, scrubbed for the public — Adam,
// audit C2, 2026-10-11: what residents understood when they posted), and
// "public" types serve names to every reader as the public record.
// Something said anonymously stays anonymous for every audience: an
// anonymous comment's event carries actor "anonymous" and no author id.
//
// Two leaks this closes:
//   1. ACCOUNT IDS. Events carry the raw hub user id as the actor, and the
//      AS2 serializer turned it into a stable global IRI
//      (`{ui}/users/<raw-id>`); payloads carry it too (`submitted_by`,
//      `created_by`, `author_id`, ...). Each is a per-user tracking handle
//      the fingerprint guardrail forbids: it re-links one person's
//      contributions across every process. Resident ids, in the actor and
//      anywhere in the payload, are replaced with a PER-PROCESS opaque token —
//      HMAC-SHA256(CIVIC_ANON_SECRET, process_id : user_id), truncated —
//      deterministic within a process (a consumer can still see that two
//      activities in one process share an author) but unlinkable across
//      processes. Officials, system actors, and DIDs pass through.
//   2. NAME-SHAPED PAYLOAD FIELDS (public only). `hub:payload` / feed
//      `data` carry the internal payload verbatim, which includes post-time
//      name snapshots (announcements stamp author_display_name). Non-official
//      snapshots are replaced with the "Admin" role label (only
//      admins/officials can author them, so a non-official author IS an
//      admin); generic name keys are dropped. `responder_name` (Civic
//      Brief responses) is kept: responders are officials by
//      construction (requireOfficial gates the write path).
//
// If CIVIC_ANON_SECRET is unset the degrade is SAFE: every resident
// actor collapses to the shared "anonymous" token — per-process
// distinctness is lost, but nothing leaks. Never fall back to a
// derivable digest. The secret must be set on prod AND preview.

import { env } from "../config/env.js";
import { createHmac } from "node:crypto";
import type { CivicEvent } from "../models/event.js";
import {
  resolveCreators,
  PUBLIC_ADMIN_NAME,
} from "../services/creatorDisplay.js";
import { toActivity, wireOrigins } from "./activitySerializer.js";
import { disclosureOfEvent, projectDocumentPayload } from "./publicPayload.js";

/** Actor values that name a PERSON (a hub participant), not machinery. */
export function isParticipantActor(actor: string | null | undefined): boolean {
  const value = (actor ?? "").trim();
  if (!value) return false;
  if (value.startsWith("did:")) return false;
  if (value.startsWith("system:") || value === "system") return false;
  if (value === "anonymous") return false;
  return true;
}

/** The bare user id behind an actor value (legacy `user:` prefix stripped). */
export function participantUserId(actor: string): string {
  return actor.startsWith("user:") ? actor.slice("user:".length) : actor;
}

/**
 * The per-process opaque token for a resident actor. Deterministic for a
 * given (secret, process, user) triple; different for the same user in a
 * different process. With no secret, or no process to scope to, degrades
 * to the shared "anonymous" token — never to anything derivable.
 */
export function anonymousActorToken(
  actor: string,
  processId: string | null | undefined,
): string {
  const secret = env.CIVIC_ANON_SECRET;
  if (!secret || !processId) return "anonymous";
  const digest = createHmac("sha256", secret)
    .update(`${processId}:${participantUserId(actor)}`)
    .digest("hex")
    .slice(0, 16);
  return `anon-${digest}`;
}

/**
 * Resolve which of a batch of events' actors are OFFICIALS (exempt from
 * anonymization). One users query for the whole page.
 */
export async function officialActorIds(
  events: CivicEvent[],
): Promise<Set<string>> {
  const ids = events
    .map((e) => e.actor)
    .filter(isParticipantActor)
    .map(participantUserId);
  const creators = await resolveCreators(ids);
  const officials = new Set<string>();
  for (const [id, creator] of creators) {
    if (creator.official) officials.add(id);
  }
  return officials;
}

/** Name-shaped payload keys that are DROPPED from public payloads. */
const DROPPED_NAME_KEYS: ReadonlySet<string> = new Set([
  "author_name",
  "creator_name",
  "full_name",
  "display_name",
]);

/**
 * Recursively scrub name-shaped fields from an event payload for the
 * public wire. `author_display_name` gets the role treatment: kept when
 * the SAME object carries a non-null `official_type` (an official's
 * announcement is public record), replaced with the "Admin" role label
 * otherwise — announcement authors are admins or officials by
 * construction, so a non-official author is an admin.
 */
export function scrubPayloadForPublic(value: unknown, depth = 0): unknown {
  if (depth > 6 || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => scrubPayloadForPublic(entry, depth + 1));
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (DROPPED_NAME_KEYS.has(key)) continue;
    if (key === "author_display_name") {
      if (typeof entry === "string" && entry.length > 0) {
        out[key] =
          (record.official_type ?? null) !== null ? entry : PUBLIC_ADMIN_NAME;
      } else {
        out[key] = entry;
      }
      continue;
    }
    out[key] = scrubPayloadForPublic(entry, depth + 1);
  }
  return out;
}

/** Who is reading: decides what is redacted (see the header). */
export type WireAudience = "admin" | "member" | "public";

/** A hub account id as stored: `user_<hex>`, or the legacy `user:<id>`. */
const ACCOUNT_ID = /^(?:user:[A-Za-z0-9_-]+|user_[A-Za-z0-9]+)$/;

/**
 * Replace every account id among a payload's string values with the
 * per-process token, wherever it sits and whatever its key is called, so a
 * new payload field cannot reintroduce the leak. Officials keep theirs.
 */
export function scrubAccountIds(
  value: unknown,
  processId: string | null | undefined,
  officials: Set<string>,
  depth = 0,
): unknown {
  if (typeof value === "string") {
    return ACCOUNT_ID.test(value) && !officials.has(participantUserId(value))
      ? anonymousActorToken(value, processId)
      : value;
  }
  if (depth > 6 || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => scrubAccountIds(entry, processId, officials, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = scrubAccountIds(entry, processId, officials, depth + 1);
  }
  return out;
}

/**
 * Redact one internal event for a non-admin reader: resident actor and
 * payload account ids → per-process opaque token, always; name-shaped
 * payload fields by the process's DECLARED disclosure policy rather than by
 * whether the reader signed in (Architecture 3, ADR-010; Adam, 2026-10-21):
 *   - "anonymous": names scrubbed for members and the public alike;
 *   - "members":   names to members, scrubbed for the public (what every
 *                  reader got before the policy existed, and the default
 *                  for an event whose type is unknown);
 *   - "public":    names for every reader — the public record.
 * The event's identity, type, timestamps, and process linkage are untouched.
 */
export function redactEvent(
  event: CivicEvent,
  officials: Set<string>,
  audience: Exclude<WireAudience, "admin">,
  policyOverride?: string | null,
): CivicEvent {
  const policy = disclosureOfEvent(event, policyOverride);
  const scrubNames =
    policy === "anonymous" ? true : policy === "public" ? false : audience === "public";
  const named = scrubNames ? scrubPayloadForPublic(event.data ?? {}) : (event.data ?? {});
  const out: CivicEvent = {
    ...event,
    data: scrubAccountIds(named, event.process_id, officials) as CivicEvent["data"],
  };
  if (
    isParticipantActor(event.actor) &&
    !officials.has(participantUserId(event.actor))
  ) {
    out.actor = anonymousActorToken(event.actor, event.process_id);
    // The person's own DID goes wherever their identity goes: hidden here.
    if (event.wire?.actor_did) {
      const { actor_did: _hidden, ...wire } = event.wire;
      out.wire = wire;
    }
  }
  return out;
}

/** redactEvent for a signed-out caller of GET /api/feed. */
export function redactEventForPublic(
  event: CivicEvent,
  officials: Set<string>,
): CivicEvent {
  return redactEvent(event, officials, "public");
}

/**
 * Serialize one event for a non-admin caller of the AS2 surface. The
 * default toActivity() output (admins, the emission-path validator, the
 * golden tests) is byte-identical to before — this wrapper only exists on
 * the redacted read paths.
 *
 * The actor IRI for a resident is process-scoped:
 *   {ui}/process/<pid>/participants/<opaque token>
 * so it cannot re-link the person across processes; with no process to
 * scope to it is the shared {ui}/users/anonymous.
 */
export function toRedactedActivity(
  event: CivicEvent,
  officials: Set<string>,
  audience: Exclude<WireAudience, "admin">,
): Record<string, unknown> {
  const redacted = redactEvent(event, officials, audience);
  // The AS2 surface serves a non-admin only the payload fields the event's
  // type declares public: the full document is built first (so object types,
  // names and statuses come from the stored payload exactly as before) and
  // `hub:payload` alone is then projected (Architecture 3;
  // src/events/publicPayload.ts). The internal /api/feed does not pass
  // through here and keeps its shape.
  if (redacted.actor === event.actor) {
    // Official / system / DID actor — default serialization of the
    // scrubbed event.
    return projectDocumentPayload(toActivity(redacted), event.event_type);
  }
  // Minted on the origins the event's row froze (ADR-008): the process's for
  // a process-scoped token, the event's own for the shared anonymous IRI.
  const origins = wireOrigins(event);
  const actorIri = event.process_id
    ? `${origins.processUi}/process/${event.process_id}/participants/${redacted.actor}`
    : `${origins.ui}/users/anonymous`;
  return projectDocumentPayload(
    toActivity(redacted, { actorIriOverride: actorIri }),
    event.event_type,
  );
}

/** toRedactedActivity for a signed-out caller. */
export function toPublicActivity(
  event: CivicEvent,
  officials: Set<string>,
): Record<string, unknown> {
  return toRedactedActivity(event, officials, "public");
}
