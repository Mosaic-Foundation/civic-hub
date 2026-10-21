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
