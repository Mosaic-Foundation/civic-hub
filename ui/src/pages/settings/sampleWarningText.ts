// The words of the sample-removal warning (split from sampleWarning.tsx).

import type { SampleContentSummary } from "../../services/api";

const KIND_NOUN: Record<string, [string, string]> = {
  comment: ["comment", "comments"],
  endorsement: ["endorsement", "endorsements"],
  ballot: ["ballot", "ballots"],
  statement: ["statement", "statements"],
  reaction: ["reaction to a statement", "reactions to statements"],
  submission: ["submission", "submissions"],
  response: ["official response", "official responses"],
  going: ["person going to an event", "people going to events"],
  review: ["proposed edit", "proposed edits"],
};

export function count(n: number, [one, many]: [string, string]): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 comments, 1 ballot" — real people's input that goes with the samples. */
export function realInputPhrase(summary: SampleContentSummary): string {
  return Object.entries(summary.real_input)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => count(n, KIND_NOUN[kind] ?? [kind, `${kind}s`]))
    .join(", ");
}
