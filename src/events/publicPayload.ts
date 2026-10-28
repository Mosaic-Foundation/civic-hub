// The declared public payload (Architecture 3, ADR-010; Adam, 2026-10-21).
//
// `hub:payload` used to carry each event's internal `data` verbatim to every
// reader. Now each process type's manifest declares, per event type, the
// payload fields that are public, and the wire serves a member or public
// reader those fields and nothing else. Admins are served the stored payload
// verbatim (the audit surface), and nothing here touches storage or the
// internal /api/feed: this is a serve-time projection on the AS2 surface,
// applied in events/publicRedaction.ts.
//
// The filter is an allowlist of TOP-LEVEL payload keys; a declared key keeps
// its whole subtree. Three layers make a key public:
//   1. ALWAYS: `data.process` (the type/title/status block emitEvent stamps).
//   2. HOST_PUBLIC_PAYLOAD: keys of host-owned event types (comments, the
//      Move, retired host types whose stored history must keep serving the
//      bytes it has always served).
//   3. The manifest of the event's process type (`data.process.type`):
//      manifest.publicPayload[event_type].
//
// Every key that history serves publicly today is declared, except the fields
// Adam approved to remove (Architecture 3, field rows 1–7): a brief's
// publication_status and delivered_to_count, Polis's polis_conversation_id,
// summary_status and brief_revision, the started/ended process_id and
// process_type duplicates, and vote_results' results_id. The shape diff
// (scripts/wire-shape-diff.ts) holds the served views to exactly that list.

import { LEGACY_TYPES, MANIFEST_LIST } from "../shared/processManifests.js";
import { DISCLOSURE_POLICIES, type DisclosurePolicy } from "../processes/manifest.js";
import type { CivicEvent } from "../models/event.js";
import { usesHubTerms } from "./activitySerializer.js";

/** Always public: the process block emitEvent stamps on every event. */
const ALWAYS: ReadonlySet<string> = new Set(["process"]);

/**
 * Public payload keys of host-owned event types, whatever the process type.
 * Retired types are declared in full: their stored history is already on the
 * public wire and keeps serving the same bytes.
 */
const HOST_PUBLIC_PAYLOAD: Readonly<Record<string, readonly string[]>> = {
  // A comment on any process (src/modules/civic.input).
  "civic.process.comment_added": ["comment"],
  // The shared edit path (src/services/processEdits.ts) records a public edit
  // history on any editable type.
  "civic.process.updated": ["edit"],
  // The hub moved (ADR-008): the whole payload is the move record.
  "civic.hub.moved": ["move"],
  // Retired (the Polis close path, pre-civic.brief): stored history only.
  "civic.outcome_delivered": [
    "originating_process_id",
    "originating_process_type",
    "outcome_id",
    "outcome",
    "delivered_to",
    "recipient",
    "target",
  ],
};

/** publicPayload of every manifest, keyed by process type. */
const BY_TYPE: ReadonlyMap<string, Readonly<Record<string, readonly string[]>>> = new Map([
  ...MANIFEST_LIST.map((m) => [m.descriptor.type, m.publicPayload] as const),
  // Retired types' stored events read as they did (engine 2, C).
  ...LEGACY_TYPES.map((l) => [l.type, l.publicPayload] as const),
]);

/**
 * A type's OWN namespaced events (civic.proposal.*, civic.project.*) name
 * their type themselves, so their declaration applies whether or not the row
 * stamped data.process.type (old rows did not).
 */
const OWN_EVENT_KEYS: ReadonlyMap<string, readonly string[]> = new Map(
  MANIFEST_LIST.flatMap((m) => {
    const own = new Set([...Object.keys(m.activities), ...Object.keys(m.legacyActivities ?? {})]);
    return Object.entries(m.publicPayload).filter(([eventType]) => own.has(eventType));
  }),
);

/**
 * For a HOST event type on a row that never stamped data.process.type (events
 * from before the stamp existed): the union of every manifest's declaration
 * for that event type. Generous but still declared — an unstamped historical
 * row keeps every field some type declares public, and nothing undeclared.
 */
const UNION_BY_EVENT: ReadonlyMap<string, readonly string[]> = (() => {
  const union = new Map<string, Set<string>>();
  for (const m of [...MANIFEST_LIST, ...LEGACY_TYPES]) {
    for (const [eventType, keys] of Object.entries(m.publicPayload)) {
      const set = union.get(eventType) ?? new Set<string>();
      for (const k of keys) set.add(k);
      union.set(eventType, set);
    }
  }
  return new Map([...union.entries()].map(([k, v]) => [k, [...v]]));
})();

/**
 * Each type's declared disclosure policy (manifest.disclosure; Architecture 3,
 * ADR-010): who a participant's name is served to. "members" — today's
 * behaviour before the policy existed — is the default for an event whose
 * type is unknown (old rows that never stamped data.process.type), so an
 * undeclared row discloses nothing it did not already.
 */
const DISCLOSURE_BY_TYPE: ReadonlyMap<string, DisclosurePolicy> = new Map([
  ...MANIFEST_LIST.map((m) => [m.descriptor.type, m.disclosure] as const),
  ...LEGACY_TYPES.map((l) => [l.type, l.disclosure] as const),
]);

/** Process types whose processes may override their disclosure policy. */
const DISCLOSURE_OVERRIDABLE: ReadonlySet<string> = new Set(
  MANIFEST_LIST.filter((m) => m.disclosureOverridable).map((m) => m.descriptor.type),
);

/** The declared disclosure policy of a process type ("members" when unknown). */
export function disclosureOf(processType: string | null): DisclosurePolicy {
  return (processType && DISCLOSURE_BY_TYPE.get(processType)) || "members";
}

/**
 * The disclosure policy an event is served under: its process's own declared
 * override where the type allows one, else the type's default. The override
 * comes from the process row (state.disclosure_policy), resolved by the
 * serving layer; an event alone resolves to the type's default.
 */
export function disclosureOfEvent(
  event: Pick<CivicEvent, "data">,
  processOverride?: string | null,
): DisclosurePolicy {
  const processType = processTypeOf(event.data ?? {});
  if (
    processOverride &&
    processType &&
    DISCLOSURE_OVERRIDABLE.has(processType) &&
    (DISCLOSURE_POLICIES as readonly string[]).includes(processOverride)
  ) {
    return processOverride as DisclosurePolicy;
  }
  return disclosureOf(processType);
}

/**
 * May an event carry its actor's own DID (ADR-011; Adam, Q4)? Only where its
 * type's policy serves an actor at all: never for "anonymous", which serves no
 * actor, DID or not; and never for a type whose processes may override their
 * policy, since an event alone cannot know the override.
 */
export function actorDidServable(event: Pick<CivicEvent, "data">): boolean {
  const processType = processTypeOf(event.data ?? {});
  if (processType && DISCLOSURE_OVERRIDABLE.has(processType)) return false;
  return disclosureOf(processType) !== "anonymous";
}

/** The canonical process type an event carries, stamped by emitEvent. */
function processTypeOf(data: Record<string, unknown>): string | null {
  const process = data.process;
  if (process && typeof process === "object" && !Array.isArray(process)) {
    const type = (process as Record<string, unknown>).type;
    if (typeof type === "string" && type) return type;
  }
  const bare = data.process_type;
  return typeof bare === "string" && bare ? bare : null;
}

/** The public payload keys of one event: ALWAYS + host + its type's declaration. */
export function publicPayloadKeys(
  eventType: string,
  processType: string | null,
): ReadonlySet<string> {
  const keys = new Set<string>(ALWAYS);
  for (const k of HOST_PUBLIC_PAYLOAD[eventType] ?? []) keys.add(k);
  for (const k of OWN_EVENT_KEYS.get(eventType) ?? []) keys.add(k);
  const declared = processType
    ? BY_TYPE.get(processType)?.[eventType]
    : UNION_BY_EVENT.get(eventType);
  for (const k of declared ?? []) keys.add(k);
  return keys;
}

/** The process type an already-serialized document carries, if any. */
export function documentProcessType(document: Record<string, unknown>): string | null {
  const object = document.object;
  const payload =
    object && typeof object === "object" && !Array.isArray(object)
      ? (object as Record<string, unknown>)["hub:payload"]
      : null;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const fromPayload = processTypeOf(payload as Record<string, unknown>);
    if (fromPayload) return fromPayload;
  }
  const context = document.context;
  const fromContext =
    context && typeof context === "object" && !Array.isArray(context)
      ? (context as Record<string, unknown>)["civic:processType"]
      : null;
  return typeof fromContext === "string" && fromContext ? fromContext : null;
}

/**
 * Which view of a PRE-POLICY snapshot a served view must now equal, after the
 * payload projection (the second transform the shape invariant allows;
 * Architecture 3, Q6): the declared disclosure policy moved an anonymous
 * type's member view onto the old public one (names scrubbed for members
 * too) and a public type's public view onto the old member one (names are
 * the public record). A "members" type is byte-stable. The two views only
 * ever differed by the name scrub, which is what makes this mapping exact.
 */
export function policyBeforeView(
  view: "member" | "public",
  processType: string | null,
): "member" | "public" {
  const policy = disclosureOf(processType);
  if (policy === "anonymous") return "public";
  if (policy === "public") return "member";
  return view;
}

/**
 * The declared projection applied to an ALREADY-SERIALIZED member or public
 * document: `hub:payload` reduced to the event type's public keys, removed
 * when nothing public is left (the serializer never writes an empty payload),
 * and the `hub` context entry dropped with the last hub term. This is the
 * transform the wire-shape invariant allows and nothing else: the before/after
 * tests and scripts/wire-shape-diff.ts both derive their expectation with it.
 * The document is returned unchanged (same reference) when nothing is dropped.
 */
export function projectDocumentPayload(
  document: Record<string, unknown>,
  eventType: string,
): Record<string, unknown> {
  const object = document.object;
  if (!object || typeof object !== "object" || Array.isArray(object)) return document;
  const payload = (object as Record<string, unknown>)["hub:payload"];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return document;

  const data = payload as Record<string, unknown>;
  const context = document.context;
  const contextType =
    context && typeof context === "object" && !Array.isArray(context)
      ? (context as Record<string, unknown>)["civic:processType"]
      : null;
  const processType =
    processTypeOf(data) ?? (typeof contextType === "string" && contextType ? contextType : null);
  const keys = publicPayloadKeys(eventType, processType);
  const entries = Object.entries(data);
  if (entries.every(([k]) => keys.has(k))) return document;

  const filtered: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    if (keys.has(k)) filtered[k] = v;
  }
  const outObject: Record<string, unknown> = { ...(object as Record<string, unknown>) };
  if (Object.keys(filtered).length > 0) {
    outObject["hub:payload"] = filtered;
  } else {
    delete outObject["hub:payload"];
  }
  const out: Record<string, unknown> = { ...document, object: outObject };

  // The serializer declares the `hub` namespace only on documents that use a
  // hub term; mirror its check (activitySerializer's usesHubTerms) when the
  // payload was the last one.
  const stillUsesHubTerms = usesHubTerms(outObject) || usesHubTerms(out.target);
  if (!stillUsesHubTerms && Array.isArray(out["@context"])) {
    out["@context"] = (out["@context"] as unknown[]).filter(
      (entry) => !(entry && typeof entry === "object" && "hub" in (entry as Record<string, unknown>)),
    );
  }
  return out;
}

