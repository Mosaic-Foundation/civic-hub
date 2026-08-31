// Activity serializer — projects internal CivicEvents onto the wire as
// ActivityStreams 2.0 documents conforming to the Civic Activity
// Specification v0.2 (civic-social-docs/specs/civic-activity-spec.md).
//
// WHY A SERIALIZER AND NOT A NEW EVENT MODEL
// The v0.2 spec retired the v0.1 envelope (`event_type` / `data` /
// `meta.visibility`) in favour of AS2. The hub converts by SERIALIZING AT THE
// EDGE: the internal CivicEvent, the append-only Postgres log, emitEvent(),
// every module's events.ts, the feed classifier and the digest are unchanged.
// This module is the only place the wire format is decided. The Civic Space
// Specification (§2.2) names activity emission and storage as separable
// concerns; the event log stays the source of truth and the wire is a
// projection of it. Everything downstream of the wire — activity signing,
// ActivityPub delivery, the portability export, a later AT Protocol bridge —
// attaches to this seam.
//
// DEFERRED — PROCESS RELATIONSHIPS (pick this up when the AS2 bridge starts)
// Light process-linking (2026-08-25) introduced a typed relationship between
// two processes: continues / references / implements, stored once in
// `process_links` and rendered from both ends. NO SPEC COVERS IT — not
// civic-process.md, not civic-hub.md, not civic-activity.md.
//
// So today a link reaches the wire only inside `hub:payload`, as
// `data.process.link` on a civic.process.updated / Update. That is recorded
// but not EXPRESSED: a federated consumer sees an opaque blob, not a
// relationship it can follow.
//
// AS2 already has the right homes for this, and the activity spec's own
// mapping table (§9) earmarks one of them: `process_id -> object.context
// (future extension)`. When the bridge work begins, decide between
// `context`, `inReplyTo`, `target`, and a first-class `Relationship` object,
// then project process_links properly instead of leaving it in the payload.
// Amending the activity spec to define process relationships is a design-
// review question for Adam, not a code change to make unilaterally.
//
// Decision of record (Adam, 2026-08-25): ship the hub-local form now, do this
// at bridge time. Changing the projection later IS a wire change — update the
// goldens deliberately, with the spec open.
//
// TWO CALLERS, ONE FUNCTION
//   1. GET /events and GET /activities/:id serialize stored events on read.
//   2. emitEvent() serializes each event before it is appended, so an event
//      that cannot be represented on the wire is never stored (spec §7.2,
//      "validate at the emission path").
//
// FAIL LOUDLY. An `event_type` with no entry in ACTIVITY_MAPPINGS throws.
// Silently emitting a generic activity for an unknown type is the failure
// mode this design forbids: it would put unclassifiable documents on a
// public, permanent wire. Adding an event type therefore means adding a row
// to the table below — enforced by tests/unit/activitySerializer.test.ts,
// which re-enumerates every event_type literal in src/ and fails on a gap.
//
// DETERMINISTIC. Same event in, byte-identical document out: no clocks, no
// randomness, no iteration over unordered sets. Future work signs these
// documents, and a signature over a non-deterministic serialization is
// worthless.

import { CivicEvent } from "../models/event.js";
import { baseUrl, uiBaseUrl } from "../utils/baseUrl.js";
import {
  civicPlaceCode,
  civicPlaceName,
  hubName,
  normalizePlaceCode,
  spaceDid,
} from "../config/hub.js";

// --- Context IRIs ----------------------------------------------------------

export const AS2_CONTEXT = "https://www.w3.org/ns/activitystreams";
/** Provisional until published — Civic Activity Spec §2.1, Open Question 1. */
export const CIVIC_CONTEXT = "https://civic.social/ns/civic";
export const PUBLIC_AUDIENCE = "https://www.w3.org/ns/activitystreams#Public";

/**
 * Namespace for hub-local extension terms (`hub:` prefixed). Per spec §3.4 an
 * extension defines its terms under a domain its author controls; this hub's
 * terms live under its own origin. The `hub` context entry is added ONLY to
 * documents that actually use a hub term — see EXTENSION_TERMS below for the
 * full register (they are promotion candidates for the civic context).
 */
export function hubNamespace(): string {
  return `${baseUrl()}/ns#`;
}

/**
 * Every hub-local extension term this serializer can emit, with the reason it
 * has no canonical home yet. Kept beside the mapping table so the register in
 * HANDOFF.md can never silently drift from the code.
 */
export const EXTENSION_TERMS: ReadonlyArray<{
  term: string;
  kind: "object type" | "property";
  why: string;
}> = [
  { term: "hub:payload", kind: "property", why: "Verbatim carry of the internal event's `data`. Preserves fidelity for consumers without renaming or reinterpreting hub-specific fields." },
  { term: "hub:ProposedProcess", kind: "object type", why: "A process offered for community support before it opens. No canonical civic class yet." },
  { term: "hub:SupportThreshold", kind: "object type", why: "The support threshold of a proposed process being reached." },
  { term: "hub:Aggregation", kind: "object type", why: "Raw participation aggregated into structured results — the step before a result is published." },
  { term: "hub:Submission", kind: "object type", why: "Free-text participation with no ballot/comment shape (word clouds)." },
  { term: "hub:Project", kind: "object type", why: "A community project page. A candidate civic process class, not yet in the registry." },
  { term: "hub:ProjectSentiment", kind: "object type", why: "Aggregate support/oppose sentiment on a project." },
  { term: "hub:ReviewSubmission", kind: "object type", why: "A resident submission moving through the hub's admin review workflow. Space-internal correspondence, always restricted." },
  { term: "hub:OfficialResponse", kind: "object type", why: "A public on-the-record response by a designated official to a published Civic Brief. No canonical civic class yet." },
  { term: "hub:ProcessAction", kind: "object type", why: "Generic fallback object for civic.process.action_taken payloads that are not official responses." },
];

// --- Public API ------------------------------------------------------------

/**
 * Wire options for audience-dependent serialization. Default (absent) is
 * the canonical member/admin document — byte-identical to before these
 * options existed, which is what the golden tests and the emission-path
 * validator rely on. `actorIriOverride` is set only by the public read
 * path (events/publicRedaction.ts) to replace a resident's stable
 * per-user IRI with a process-scoped opaque one.
 */
export interface WireOptions {
  actorIriOverride?: string;
}

/**
 * Project an internal CivicEvent onto an AS2 document.
 *
 * @throws if the event's type has no mapping, or a required field
 *   (`id`, `timestamp`) is missing or malformed.
 */
export function toActivity(
  event: CivicEvent,
  wire: WireOptions = {},
): Record<string, unknown> {
  const mapping = ACTIVITY_MAPPINGS[event.event_type];
  if (!mapping) {
    throw new UnmappedEventTypeError(event.event_type);
  }
  if (!event.id) {
    throw new ActivitySerializationError(
      `event has no id (event_type "${event.event_type}")`,
    );
  }

  const env: SerializerEnv = {
    base: baseUrl(),
    ui: uiBaseUrl(),
  };
  const data = event.data ?? {};

  const object = mapping.buildObject(event, data, env);
  const target = mapping.buildTarget?.(event, data, env);
  const context = processContext(event, data, env);
  const location = placeOf(event);
  const published = toRfc3339(event.timestamp, event.event_type);

  // Property order is fixed and mirrors the spec's own examples so documents
  // are diffable by eye. JSON.stringify preserves insertion order, which is
  // what makes the output byte-stable.
  const activity: Record<string, unknown> = {
    "@context": contextFor(usesHubTerms(object) || usesHubTerms(target)),
    id: `${env.base}/activities/${event.id}`,
    type: mapping.type,
    actor: wire.actorIriOverride ?? actorIri(event.actor, env),
    published,
    to: audienceOf(event, env),
    generator: {
      id: spaceDid(),
      type: ["Organization", "civic:Hub"],
      name: hubName(),
      url: env.base,
    },
  };
  if (location) activity.location = location;
  if (context) activity.context = context;
  activity.object = object;
  if (target !== undefined) activity.target = target;
  if (event.action_url) activity.url = event.action_url;

  return activity;
}

/**
 * Emission-path guard (spec §7.2). Runs the full serialization and additionally
 * enforces the requirements an EMITTER owes but a historical stored row may
 * predate — today, a non-empty actor. Returns the serialized document so the
 * caller can debug-log it; the wire form is never stored.
 *
 * @throws if the event cannot be represented as a conformant Civic Activity.
 */
export function validateForEmission(event: CivicEvent): Record<string, unknown> {
  if (!event.actor || !event.actor.trim()) {
    throw new ActivitySerializationError(
      `event has no actor (event_type "${event.event_type}") — ` +
        `AS2 requires one; use a "system:<component>" actor for hub machinery`,
    );
  }
  assertNoBallotSelection(event);
  return toActivity(event);
}

/** Every event type this serializer knows how to project. */
export function mappedEventTypes(): string[] {
  return Object.keys(ACTIVITY_MAPPINGS).sort();
}

/**
 * The mapping table read backwards: AS2 activity type → the internal event
 * types that serialize to it. This is what lets `GET /events?type=Create`
 * (spec §6.2 filters on the ACTIVITY's type, not the hub's internal one)
 * resolve to a database filter.
 */
export function activityTypeIndex(): Record<string, string[]> {
  const index: Record<string, string[]> = {};
  for (const [eventType, mapping] of Object.entries(ACTIVITY_MAPPINGS)) {
    (index[mapping.type] ??= []).push(eventType);
  }
  return index;
}

export class ActivitySerializationError extends Error {
  constructor(message: string) {
    super(`ActivitySerializer: ${message}`);
    this.name = "ActivitySerializationError";
  }
}

export class UnmappedEventTypeError extends ActivitySerializationError {
  constructor(public readonly eventType: string) {
    super(
      `no activity mapping for event_type "${eventType}". Every emitted type ` +
        `must have an entry in ACTIVITY_MAPPINGS (src/events/activitySerializer.ts).`,
    );
  }
}

// --- Mapping table ---------------------------------------------------------

interface SerializerEnv {
  /** API origin — activity ids, system actor IRIs, hub namespace. */
  base: string;
  /** UI origin — process/participant IRIs a human can open. */
  ui: string;
}

type Payload = Record<string, unknown>;

interface ActivityMapping {
  /** The AS2 (or civic) activity type. Always a single string — spec §3.1.3. */
  type: string;
  /**
   * The civic class of the object this mapping builds, where a policy check
   * keys on it. Set for `civic:Ballot` so the ballot-secrecy guard finds
   * ballot events without pattern-matching on event_type spellings.
   */
  objectClass?: string;
  buildObject: (event: CivicEvent, data: Payload, env: SerializerEnv) => unknown;
  buildTarget?: (
    event: CivicEvent,
    data: Payload,
    env: SerializerEnv,
  ) => unknown | undefined;
}

/**
 * event_type → AS2 activity. Total over every type emitted anywhere in src/,
 * plus retired types that remain in stored history (a stored event must stay
 * serializable forever; the log is append-only).
 *
 * Assignments follow spec §3.1: an AS2 verb wherever one natively expresses
 * the action, one of the three civic verbs (civic:Frame / civic:Start /
 * civic:End) where none does, and a `hub:`-typed extension object for the
 * hub-local families the civic registry has no home for yet.
 */
const ACTIVITY_MAPPINGS: Record<string, ActivityMapping> = {
  // --- Process lifecycle (spec §3.2) ---------------------------------------
  "civic.process.created": {
    type: "Create",
    buildObject: (e, data, env) => processObject(e, data, env),
  },
  "civic.process.updated": {
    type: "Update",
    buildObject: (e, data, env) => processObject(e, data, env),
  },
  "civic.process.started": {
    type: "civic:Start",
    buildObject: (e, data, env) => processObject(e, data, env),
  },
  "civic.process.ended": {
    type: "civic:End",
    buildObject: (e, data, env) =>
      processObject(e, data, env, { terminalState: "closed" }),
  },
  "civic.process.result_published": {
    type: "Announce",
    buildObject: (e, data) => resultObject(data),
  },

  // --- Participation (spec §3.2) -------------------------------------------
  "civic.process.vote_submitted": {
    type: "Create",
    objectClass: "civic:Ballot",
    buildObject: (e, data) => ballotObject(e, data),
  },
  "civic.process.comment_added": {
    type: "Create",
    buildObject: (e, data, env) => noteObject(e, data, env),
  },
  "civic.proposal.submitted": {
    type: "Create",
    buildObject: (e, data, env) =>
      civicObject("civic:Proposal", data, {
        id: processIri(e, env),
        name: titleOf(data),
      }),
  },
  // AS2's own verb for endorsement — no civic term needed (spec §3.1 rule 1).
  "civic.proposal.supported": {
    type: "Like",
    buildObject: (e, data, env) =>
      civicObject("civic:Proposal", data, { id: processIri(e, env) }),
  },
  // Emitter exists (civic.proposals/events.ts) but nothing calls it today —
  // mapped so the type stays serializable if the path is ever wired up.
  "civic.proposal.endorsed": {
    type: "Like",
    buildObject: (e, data, env) =>
      civicObject("civic:Proposal", data, { id: processIri(e, env) }),
  },
  "civic.proposal.closed": {
    type: "civic:End",
    buildObject: (e, data, env) =>
      processObject(e, data, env, { terminalState: "closed" }),
  },

  // --- Outcomes (spec §3.2) ------------------------------------------------
  "civic.process.outcome_recorded": {
    type: "Create",
    buildObject: (e, data) => civicObject("civic:Outcome", data, {}),
  },
  // Retired: the Polis close path stopped auto-delivering outcomes when the
  // universal civic.brief seam landed. Stored history still carries it.
  "civic.outcome_delivered": {
    type: "Announce",
    buildObject: (e, data) => civicObject("civic:Outcome", data, {}),
    buildTarget: (e, data) => deliveryTarget(data),
  },

  // A generic action executed against a process (Civic Event Spec's
  // canonical catch-all verb). Today's sole emitter is the official
  // response to a published brief (data.action = "official_response"),
  // which gets its own extension object so a consumer can recognize the
  // government's side of the record without sniffing payloads; any other
  // action serializes as the generic hub:ProcessAction.
  "civic.process.action_taken": {
    type: "Create",
    buildObject: (e, data, env) =>
      civicObject(
        data.action === "official_response"
          ? "hub:OfficialResponse"
          : "hub:ProcessAction",
        data,
        { id: processIri(e, env), name: titleOf(data) },
      ),
  },

  // --- Hub-local process families (spec §3.4 extension objects) ------------
  "civic.process.proposed": {
    type: "Offer",
    buildObject: (e, data, env) =>
      civicObject("hub:ProposedProcess", data, {
        id: processIri(e, env),
        name: titleOf(data),
      }),
  },
  "civic.process.threshold_met": {
    type: "Announce",
    buildObject: (e, data) => civicObject("hub:SupportThreshold", data, {}),
  },
  "civic.process.aggregation_completed": {
    type: "Create",
    buildObject: (e, data) => civicObject("hub:Aggregation", data, {}),
  },
  "civic.process.submission_received": {
    type: "Create",
    buildObject: (e, data) => civicObject("hub:Submission", data, {}),
  },

  // --- Projects (hub-local; a candidate civic process class) ---------------
  "civic.project.created": {
    type: "Create",
    buildObject: (e, data, env) =>
      civicObject("hub:Project", data, {
        id: processIri(e, env),
        name: titleOf(data),
      }),
  },
  "civic.project.updated": {
    type: "Update",
    buildObject: (e, data, env) =>
      civicObject("hub:Project", data, { id: processIri(e, env) }),
  },
  "civic.project.comment_added": {
    type: "Create",
    buildObject: (e, data, env) => noteObject(e, data, env),
  },
  "civic.project.archived": {
    type: "civic:End",
    buildObject: (e, data, env) =>
      processObject(e, data, env, { terminalState: "archived" }),
  },
  "civic.project.sentiment_changed": {
    type: "Update",
    buildObject: (e, data, env) =>
      civicObject("hub:ProjectSentiment", data, {
        id: processIri(e, env),
      }),
  },

  // --- Admin review workflow (always restricted) ---------------------------
  // AS2 has native verbs for the accept/reject shape of a review decision;
  // only the object being reviewed needs a hub term.
  "civic.review.submitted": {
    type: "Create",
    buildObject: (e, data, env) => reviewObject(e, data, env),
  },
  "civic.review.approved": {
    type: "Accept",
    buildObject: (e, data, env) => reviewObject(e, data, env),
  },
  "civic.review.changes_requested": {
    type: "TentativeReject",
    buildObject: (e, data, env) => reviewObject(e, data, env),
  },
  "civic.review.declined": {
    type: "Reject",
    buildObject: (e, data, env) => reviewObject(e, data, env),
  },
  "civic.review.revised": {
    type: "Update",
    buildObject: (e, data, env) => reviewObject(e, data, env),
  },
  "civic.review.withdrawn": {
    type: "Undo",
    buildObject: (e, data, env) => reviewObject(e, data, env),
  },
};

// --- Object builders -------------------------------------------------------
//
// Conservative by rule: a builder carries what `data` already holds and
// invents nothing. Spec-defined properties (name, content, inReplyTo,
// civic:method, civic:terminalState) are lifted where the payload has them;
// the payload itself rides along verbatim under `hub:payload` so no
// information is lost on the wire and no hub field is silently reinterpreted
// as an AS2 one.

function processObject(
  event: CivicEvent,
  data: Payload,
  env: SerializerEnv,
  opts: { terminalState?: string } = {},
): Record<string, unknown> {
  const object: Record<string, unknown> = { type: "civic:Process" };
  const iri = processIri(event, env);
  if (iri) object.id = iri;
  const name = titleOf(data);
  if (name) object.name = name;
  if (opts.terminalState) {
    // Spec §3.2: a civic:End object carries civic:terminalState so consumers
    // detect the end of any process without knowing its lifecycle profile.
    // The payload's own status wins when it records one.
    object["civic:terminalState"] = statusOf(data) ?? opts.terminalState;
  }
  return withPayload(object, data);
}

function resultObject(data: Payload): Record<string, unknown> {
  const object: Record<string, unknown> = { type: "civic:Result" };
  const name = titleOf(data);
  if (name) object.name = name;
  return withPayload(object, data);
}

/**
 * Spec §5.4 — the worked case, and the one implementers get wrong.
 *
 * `civic:method` is carried only when the payload has it. The participant's
 * SELECTION is never published, and that is enforced here rather than left to
 * emitter discipline: `hub:payload` carries the event's `data` verbatim, so
 * "no emitter ever puts a choice in a ballot payload" would otherwise be a
 * convention one careless change could break, on a permanent public wire.
 *
 * Two layers, deliberately different:
 *   - READ path (this function): selection-shaped keys are stripped before the
 *     payload is attached, so no stored row can leak a choice even if one got
 *     in. Stripping rather than throwing, because a single bad row must not
 *     take down /events for everyone.
 *   - EMISSION path (assertNoBallotSelection, called by validateForEmission):
 *     the emit is REFUSED. At emission the harm is bigger than the wire — the
 *     event log is append-only, so storing a selection alongside the actor
 *     would permanently link voter to choice, which is exactly what
 *     civic.vote/events.ts exists to prevent.
 *
 * On-the-record voting (roll-call votes, public endorsements) is legitimate
 * and the spec allows it — but it arrives by teaching this function the
 * process's disclosure policy, NOT by deleting the guard.
 */
function ballotObject(event: CivicEvent, data: Payload): Record<string, unknown> {
  const object: Record<string, unknown> = { type: "civic:Ballot" };
  const method = methodOf(data);
  if (method) object["civic:method"] = method;

  const offending = findSelectionKey(data);
  if (!offending) return withPayload(object, data);

  console.error(
    `[activity-serializer] ballot payload for event ${event.id} contains ` +
      `"${offending}" — stripped from the wire. A stored ballot must not name ` +
      `a choice; investigate how it was written.`,
  );
  return withPayload(object, stripSelectionKeys(data) as Payload);
}

/**
 * Keys that would name *which way* a participant acted. Container keys the
 * hub already uses (`vote`, `ballot`) are absent by design — it is the leaf
 * that discloses, and `vote: { changed: false }` is fine.
 */
const BALLOT_SELECTION_KEYS: ReadonlySet<string> = new Set([
  "selection",
  "selections",
  "selected",
  "choice",
  "choices",
  "option",
  "options",
  "option_id",
  "option_ids",
  "ranking",
  "rankings",
  "ranked_choices",
  "approvals",
  "preference",
  "preferences",
  "score",
  "scores",
]);

/** First selection-shaped key anywhere in the payload, or null. */
function findSelectionKey(value: unknown, depth = 0): string | null {
  if (depth > 6 || !value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findSelectionKey(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (BALLOT_SELECTION_KEYS.has(key)) return key;
    const found = findSelectionKey(entry, depth + 1);
    if (found) return found;
  }
  return null;
}

function stripSelectionKeys(value: unknown, depth = 0): unknown {
  if (depth > 6 || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => stripSelectionKeys(entry, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (BALLOT_SELECTION_KEYS.has(key)) continue;
    out[key] = stripSelectionKeys(entry, depth + 1);
  }
  return out;
}

/**
 * Emission-path half of the ballot-secrecy guard. Refuses to store a ballot
 * event whose payload names a choice — see ballotObject above for why the
 * emission path is stricter than the read path.
 */
function assertNoBallotSelection(event: CivicEvent): void {
  const mapping = ACTIVITY_MAPPINGS[event.event_type];
  if (!mapping || mapping.objectClass !== "civic:Ballot") return;
  const offending = findSelectionKey(event.data ?? {});
  if (!offending) return;
  throw new ActivitySerializationError(
    `ballot event "${event.event_type}" carries "${offending}" in its payload. ` +
      `A ballot MUST NOT record the participant's choice alongside their ` +
      `identity: the event log is append-only, so storing it would link voter ` +
      `to choice permanently (Civic Activity Spec §5.4). If this process is ` +
      `genuinely on-the-record, that must come from its disclosure policy — ` +
      `do not remove this guard.`,
  );
}

function noteObject(
  event: CivicEvent,
  data: Payload,
  env: SerializerEnv,
): Record<string, unknown> {
  const object: Record<string, unknown> = { type: "Note" };
  const content = contentOf(data);
  if (content) object.content = content;
  // The process page is what a hub comment replies to. A per-thread IRI would
  // be more precise, but the hub has no comment threads to point at.
  const iri = processIri(event, env);
  if (iri) object.inReplyTo = iri;
  return withPayload(object, data);
}

function reviewObject(
  event: CivicEvent,
  data: Payload,
  env: SerializerEnv,
): Record<string, unknown> {
  const object: Record<string, unknown> = { type: "hub:ReviewSubmission" };
  const iri = processIri(event, env);
  if (iri) object.id = iri;
  const name = titleOf(data);
  if (name) object.name = name;
  return withPayload(object, data);
}

function civicObject(
  type: string,
  data: Payload,
  props: { id?: string | null; name?: string | null },
): Record<string, unknown> {
  const object: Record<string, unknown> = { type };
  if (props.id) object.id = props.id;
  if (props.name) object.name = props.name;
  return withPayload(object, data);
}

/**
 * Attach the internal payload verbatim. `hub:payload` is an extension property
 * (spec §3.4): an AS2 consumer ignores it, a civic consumer ignores it, and a
 * hub-aware consumer gets everything the v0.1 `data` field carried. Omitted
 * when the payload is empty — no empty-object noise on the wire.
 */
function withPayload(
  object: Record<string, unknown>,
  data: Payload,
): Record<string, unknown> {
  if (data && Object.keys(data).length > 0) {
    object["hub:payload"] = data;
  }
  return object;
}

/**
 * `target` for a delivered outcome (spec §3.2) — the recipient the outcome was
 * formally delivered to. Carried only when the payload names one.
 */
function deliveryTarget(data: Payload): unknown | undefined {
  const direct = data.delivered_to ?? data.recipient ?? data.target;
  if (typeof direct === "string" && direct) return direct;
  if (direct && typeof direct === "object") return direct;
  return undefined;
}

// --- Payload readers -------------------------------------------------------
//
// Fixed, ordered lookups over the payload shapes the hub's modules actually
// emit. Ordered so the reading is deterministic when two shapes coexist.

function nested(data: Payload, key: string): Payload | undefined {
  const value = data[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Payload)
    : undefined;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/** A human-readable title, wherever this hub's emitters put one. */
function titleOf(data: Payload): string | null {
  return firstString(
    nested(data, "process")?.title,
    nested(data, "announcement")?.title,
    nested(data, "brief")?.title,
    nested(data, "project")?.title,
    nested(data, "proposal")?.title,
    nested(data, "meeting_summary")?.title,
    data.title,
    data.topic,
  );
}

/** The process status a lifecycle payload records, if any. */
function statusOf(data: Payload): string | null {
  return firstString(nested(data, "process")?.status, data.status);
}

/** The voting method a ballot payload records, if any. */
function methodOf(data: Payload): string | null {
  return firstString(
    nested(data, "vote")?.method,
    nested(data, "ballot")?.method,
    nested(data, "process")?.method,
  );
}

/** Comment text, where the payload carries any (previews only, by design). */
function contentOf(data: Payload): string | null {
  return firstString(
    nested(data, "comment")?.body_preview,
    nested(data, "comment")?.body,
    nested(data, "comment")?.content,
  );
}

/** The canonical process type, stamped by emitEvent into data.process.type. */
function processTypeOf(data: Payload): string | null {
  return firstString(nested(data, "process")?.type, data.process_type);
}

// --- Shared property builders ----------------------------------------------

function processIri(event: CivicEvent, env: SerializerEnv): string | null {
  return event.process_id ? `${env.ui}/process/${event.process_id}` : null;
}

/**
 * Process linkage (spec §4). The IRI dereferences to the process page, and
 * `civic:processType` lets a consumer group and route activities without
 * fetching the descriptor. Omitted entirely for events with no process.
 */
function processContext(
  event: CivicEvent,
  data: Payload,
  env: SerializerEnv,
): Record<string, unknown> | null {
  const iri = processIri(event, env);
  if (!iri) return null;
  const context: Record<string, unknown> = { id: iri, type: "civic:Process" };
  const processType = processTypeOf(data);
  if (processType) context["civic:processType"] = processType;
  return context;
}

/**
 * Actor IRIs (spec §2.2.1). Three forms, by prefix:
 *   did:…            a participant DID — already an IRI, passed through
 *   system:<part>    hub machinery — a space-scoped system IRI naming the
 *                    specific component, never a generic "system"
 *   anything else    an opaque hub user id — a space-scoped participant IRI
 *
 * The hub's legacy `user:` prefix is stripped so the IRI reads as a path.
 * `anonymous` currently lands on `/users/anonymous`; when disclosure policy
 * ships (spec §5.3) it should become a process-scoped anonymous actor IRI.
 */
function actorIri(actor: string, env: SerializerEnv): string {
  const value = (actor ?? "").trim();
  if (!value) {
    // Historical rows only — emission is guarded by validateForEmission().
    return `${env.base}/system/unattributed`;
  }
  if (value.startsWith("did:")) return value;
  if (value.startsWith("system:")) {
    return `${env.base}/system/${encodeURIComponent(value.slice("system:".length))}`;
  }
  // Historical rows only: some pre-v0.2 machinery stamped a bare "system".
  // It is still a system actor, not a participant — serializing it under
  // /users/ would misattribute an automated transition to a person. Current
  // emitters name their component ("system:brief-spawn").
  if (value === "system") return `${env.base}/system/unspecified`;
  const id = value.startsWith("user:") ? value.slice("user:".length) : value;
  return `${env.ui}/users/${encodeURIComponent(id)}`;
}

/**
 * Addressing (spec §5.1). Public activities are addressed to as:Public;
 * restricted ones to a space-managed audience collection. The audience IRI is
 * opaque and space-controlled — it names who may see the activity, and the
 * serving rule (§5.2) is what enforces it.
 */
function audienceOf(event: CivicEvent, env: SerializerEnv): string[] {
  return event.meta?.visibility === "restricted"
    ? [`${env.base}/audiences/admins`]
    : [PUBLIC_AUDIENCE];
}

/**
 * Civic geography (spec §2.2.2). Omitted entirely — no null, no "none" — when
 * the event carries no civic place code. The configured display name is only
 * attached when the event's code is this deployment's own, so an event stamped
 * with a different jurisdiction is never mislabelled.
 */
function placeOf(event: CivicEvent): Record<string, unknown> | null {
  const code = normalizePlaceCode(event.jurisdiction);
  if (!code) return null;
  const place: Record<string, unknown> = { type: "Place" };
  const name = code === civicPlaceCode() ? civicPlaceName() : null;
  if (name) place.name = name;
  place["civic:code"] = code;
  return place;
}

/**
 * The document's `@context`: AS2 then civic, in that order (spec §2.1), plus
 * the hub extension namespace — but ONLY on documents that actually use a
 * `hub:` term, so a document with no extension in it stays pure profile.
 */
function contextFor(usesHubTerms: boolean): unknown[] {
  const context: unknown[] = [AS2_CONTEXT, CIVIC_CONTEXT];
  if (usesHubTerms) context.push({ hub: hubNamespace() });
  return context;
}

/**
 * True when a serialized object (or target) uses a hub-namespaced type or
 * property. Shallow by design: hub terms are only ever minted by the builders
 * above, never by payload contents, which ride verbatim inside `hub:payload`.
 */
function usesHubTerms(value: unknown): boolean {
  if (typeof value === "string") return value.startsWith("hub:");
  if (Array.isArray(value)) return value.some(usesHubTerms);
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key.startsWith("hub:")) return true;
      if (key === "type" && usesHubTerms(entry)) return true;
    }
  }
  return false;
}

/**
 * `published` must be RFC 3339 with an explicit offset (spec §2.2). Postgres
 * returns `…+00:00` and emitEvent stamps `…Z`; both already qualify and are
 * passed through verbatim so serialization stays byte-stable. Anything else is
 * normalized to UTC, and an unparseable timestamp is an error, not a guess.
 */
function toRfc3339(timestamp: string, eventType: string): string {
  const value = (timestamp ?? "").trim();
  if (/(Z|[+-]\d{2}:\d{2})$/.test(value)) return value;
  const parsed = value ? new Date(value) : new Date(NaN);
  if (Number.isNaN(parsed.getTime())) {
    throw new ActivitySerializationError(
      `event timestamp "${timestamp}" is not a valid date (event_type "${eventType}")`,
    );
  }
  return parsed.toISOString();
}
