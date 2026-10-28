// The words of the sample-removal warning (split from sampleWarning.tsx).

import type { SampleContentSummary } from "../../services/api";
import { DECLARED_KIND_NOUNS } from "../../../../src/shared/sampleKinds";

const KIND_NOUN: Record<string, readonly [string, string]> = {
  comment: ["comment", "comments"],
  endorsement: ["endorsement", "endorsements"],
  ballot: ["ballot", "ballots"],
  statement: ["statement", "statements"],
  reaction: ["reaction to a statement", "reactions to statements"],
  submission: ["submission", "submissions"],
  response: ["official response", "official responses"],
  review: ["proposed edit", "proposed edits"],
  // A package's own acts, as its manifest names them (engine 2, B9).
  ...DECLARED_KIND_NOUNS,
};

export function count(n: number, [one, many]: readonly [string, string]): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 comments, 1 ballot" — real people's input that goes with the samples. */
export function realInputPhrase(summary: SampleContentSummary): string {
  return Object.entries(summary.real_input)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => count(n, KIND_NOUN[kind] ?? [kind, `${kind}s`]))
    .join(", ");
}
