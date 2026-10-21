// The input every type's deadline action takes (Close early, 2026-10-13).
// In src/shared/ so process manifests, which are plain data the UI also
// reads, can use it (Architecture 2).

/**
 * The input of a type's deadline action (Close early, 2026-10-13). An admin
 * who calls it before the deadline must give a note, which the process page,
 * the brief and the admin log carry (src/services/closeEarly.ts). Every type
 * with a deadline declares it on that action; descriptorCheck says so.
 */
export const DEADLINE_CLOSE_INPUT = {
  type: "object",
  properties: {
    note: {
      type: "string",
      maxLength: 1000,
      description: "Why it is closing early. Required when an admin closes it before its deadline.",
    },
  },
  examples: [{ note: "Closed early by the conformance suite." }],
} as const;
