// The warning shown before sample content is removed (Phase 7) — the same
// words in Settings → Sample content and when graduating out of demo, so an
// admin is asked the same question both ways.

import type { SampleContentSummary } from "../../services/api";

const KIND_NOUN: Record<string, [string, string]> = {
  comment: ["comment", "comments"],
  endorsement: ["endorsement", "endorsements"],
  ballot: ["ballot", "ballots"],
  statement: ["statement", "statements"],
  reaction: ["reaction to a statement", "reactions to statements"],
  submission: ["submission", "submissions"],
  response: ["official response", "official responses"],
  review: ["proposed edit", "proposed edits"],
};

function count(n: number, [one, many]: [string, string]): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 comments, 1 ballot" — real people's input that goes with the samples. */
export function realInputPhrase(summary: SampleContentSummary): string {
  return Object.entries(summary.real_input)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => count(n, KIND_NOUN[kind] ?? [kind, `${kind}s`]))
    .join(", ");
}

export function SampleRemovalWarning({ summary }: { summary: SampleContentSummary }) {
  const real = realInputPhrase(summary);
  const added = summary.added_in_demo ?? 0;
  return (
    <div className="settings-sample-warning" role="note">
      <p>
        This deletes the {count(summary.processes, ["sample process", "sample processes"])}
        {added > 0 && <>, the {count(added, ["item", "items"])} visitors added during the demo,</>} and everything
        attached to them. It cannot be undone.
      </p>
      {summary.other_processes === 0 ? (
        <p>
          <strong>The hub will have no processes</strong> until you or other people create some.
        </p>
      ) : (
        <p>
          The hub keeps its {count(summary.other_processes, ["other process", "other processes"])}, which are not
          sample content.
        </p>
      )}
      {summary.real_input_total > 0 && (
        <p>
          <strong>Real people have taken part in the samples:</strong> {real}. Their input is deleted too, because
          the processes it belongs to are.
        </p>
      )}
    </div>
  );
}
