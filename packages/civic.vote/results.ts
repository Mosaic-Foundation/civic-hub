// civic.vote module — result computation
//
// Delegates tally computation to the voting method sub-registry.
// The old single-method computeTally is preserved as a pass-through
// for callers that already know the method or want the default.

import type { VoteResult } from "./models.js";
import { getVotingMethod, DEFAULT_METHOD, type Ballot } from "./methods.js";

export function computeTally(
  ballots: Ballot[],
  options: string[],
  method?: string,
): VoteResult {
  const m = getVotingMethod(method ?? DEFAULT_METHOD);
  return m.computeTally(ballots, options);
}
