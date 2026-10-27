// feedWire.ts — reading the feed's cards back off the public wire (frontend
// pass, 2026-10-24).
//
// The hub's feed page reads GET /events, the AS2 stream any outside reader
// gets (member or admin view when signed in), instead of the private
// /api/feed. The card classifier (feedActivity.ts) speaks the internal event
// shape, so this module turns a served activity back into the four fields the
// classifier reads: event_type, process_id, action_url and data.
//
// It is the inverse of src/events/activitySerializer.ts for the event types
// that make cards (FEED_EVENT_TYPES), and nothing more: an activity whose
// (type, object type) pair is not listed here is not a card. A unit test
// (tests/unit/feedWire.test.ts) serializes every mapped event type through the
// real serializer and fails if a card type's pair is missing here, if a pair
// is ambiguous, or if a round trip changes what the classifier decides.
//
// Shared by the UI (Feed.tsx) and the tests; plain data and functions only.

/** The serialized form of each card-making event type. */
export const FEED_WIRE_FORMS: ReadonlyArray<{ type: string; object: string; event: string }> = [
  { type: "Create", object: "civic:Process", event: "civic.process.created" },
  { type: "civic:Start", object: "civic:Process", event: "civic.process.started" },
  { type: "Announce", object: "civic:Result", event: "civic.process.result_published" },
  { type: "Create", object: "civic:Proposal", event: "civic.proposal.submitted" },
  { type: "Create", object: "hub:Project", event: "civic.project.created" },
  { type: "Update", object: "hub:Project", event: "civic.project.updated" },
  { type: "Create", object: "hub:OfficialResponse", event: "civic.process.action_taken" },
  { type: "Create", object: "hub:ProcessAction", event: "civic.process.action_taken" },
  { type: "Announce", object: "civic:Outcome", event: "civic.outcome_delivered" },
  // The Events plugin's publish: a Create of an AS2 Event (its wireObject).
  { type: "Create", object: "Event", event: "civic.event.published" },
];

const BY_PAIR: ReadonlyMap<string, string> = new Map(FEED_WIRE_FORMS.map((f) => [`${f.type} ${f.object}`, f.event]));

/** The internal event a served activity stands for, as the feed reads it. */
export interface WireFeedEvent {
  /** The event's id: the last segment of the activity's id. */
  id: string;
  event_type: string;
  timestamp: string;
  process_id: string;
  action_url: string;
  data: Record<string, unknown>;
}

type Json = Record<string, unknown>;

function asObject(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** The process id at the end of a process IRI (`…/process/<id>`). */
function processIdOfIri(iri: unknown): string | null {
  const s = str(iri);
  if (!s) return null;
  const at = s.lastIndexOf("/process/");
  return at >= 0 ? s.slice(at + "/process/".length).split(/[/?#]/)[0] || null : null;
}

/**
 * The event a served activity stands for, or null when it is not one of the
 * card-making forms (a ballot, a comment, an update, a Tombstone…).
 */
export function fromWireActivity(activity: unknown): WireFeedEvent | null {
  const a = asObject(activity);
  if (!a) return null;
  const object = asObject(a.object);
  const type = str(a.type);
  const objectType = str(object?.type);
  if (!type || !objectType) return null;
  const eventType = BY_PAIR.get(`${type} ${objectType}`);
  if (!eventType) return null;

  const id = str(a.id)?.split("/").pop();
  const timestamp = str(a.published);
  const data = asObject(object?.["hub:payload"]) ?? {};
  // A result published as its own process (a brief, `data.result_of`) names
  // its source as the context and is itself the object; everything else's
  // process is the context.
  const ownResult = eventType === "civic.process.result_published" && data.result_of;
  const processId = ownResult ? processIdOfIri(object?.id) : processIdOfIri(asObject(a.context)?.id);
  if (!id || !timestamp || !processId) return null;

  return {
    id,
    event_type: eventType,
    timestamp,
    process_id: processId,
    action_url: str(a.url) ?? "",
    data,
  };
}

/**
 * The cursor for the page after this one: the `cursor` parameter of a page's
 * `next` link, or null on the last page.
 */
export function nextCursorOf(page: unknown): string | null {
  const next = str(asObject(page)?.next);
  if (!next) return null;
  try {
    return new URL(next).searchParams.get("cursor");
  } catch {
    return null;
  }
}
