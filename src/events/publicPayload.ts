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

import { MANIFEST_LIST } from "../shared/processManifests.js";
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
const BY_TYPE: ReadonlyMap<string, Readonly<Record<string, readonly string[]>>> = new Map(
  MANIFEST_LIST.map((m) => [m.descriptor.type, m.publicPayload]),
);

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
  const declared = processType ? BY_TYPE.get(processType)?.[eventType] : undefined;
  for (const k of declared ?? []) keys.add(k);
  return keys;
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

