// How a type's own event serializes on the wire, as data (Architecture 2,
// 2026-10-21). A process manifest carries one recipe per event type in its
// own namespace (civic.proposal.*, civic.project.*); the serializer
// (src/events/activitySerializer.ts) turns a recipe into its mapping with the
// same builders the host's own mappings use, so a recipe and a hand-written
// mapping give the same bytes. Data, not functions, so a manifest needs
// nothing from the serializer and stays readable by the UI.

/** The object an activity carries. */
export type ActivityObjectRecipe =
  /**
   * A civic object of `class` (e.g. "civic:Proposal", "hub:Project") built
   * from the payload. `id: "process"` sets its id to the process IRI;
   * `name: "title"` sets its name to the payload's title.
   */
  | { kind: "civic"; class: string; id?: "process"; name?: "title" }
  /** The process itself, optionally at a terminal state ("closed", "archived"). */
  | { kind: "process"; terminalState?: string }
  /** A comment, as an AS2 Note. */
  | { kind: "note" };

export interface ActivityRecipe {
  /** The AS2 (or civic) activity type: "Create", "Like", "civic:End". */
  type: string;
  object: ActivityObjectRecipe;
}

/**
 * The object a type's processes are on the wire, when it is a standard
 * vocabulary object rather than a `civic:Process` (an AS2 `Event`; plugin
 * Events, 2026-10-27). The serializer builds every process object of the type
 * as usual, then, when the payload carries every `requires` property, types it
 * `type` and lifts each declared property from the payload, in declared order,
 * before `hub:payload`. A payload without them (the hub's own `created`, a
 * status change) keeps `civic:Process`, so nothing that lacks the object's
 * substance claims to be one.
 */
export interface WireObjectRecipe {
  /** The object's type: "Event". */
  type: string;
  /**
   * Wire property → payload path, dotted, under `process` (always public, so
   * nothing lifted escapes the type's declared public shape):
   * `{ startTime: "process.event.start_time" }`.
   */
  properties: Readonly<Record<string, string>>;
  /** Wire properties that must all be present for the object to take `type`. */
  requires: readonly string[];
}
