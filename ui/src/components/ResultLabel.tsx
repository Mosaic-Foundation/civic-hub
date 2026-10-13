// One option's label on a results bar (vote panel, results page).
//
// - The label sits above its bar, full width, so it reads as written instead
//   of wrapping in a narrow column (Adam's Oct 10 walk).
// - A label longer than today's option limit (votes made before it) shows
//   three lines; a tap shows the rest.
// - The voter's own choice carries "✓ Your vote", worked out from the
//   receipt this browser holds, never from the server, which keeps nothing
//   that links a person to a ballot.

import { useState } from "react";
import { VOTE_OPTION_MAX } from "../../../src/shared/voteOptions";

export default function ResultLabel({ option, mine }: { option: string; mine: boolean }) {
  const [open, setOpen] = useState(false);
  const mark = mine ? (
    <span className="result-mine">
      <span aria-hidden="true">✓ </span>Your vote
    </span>
  ) : null;
  if (option.length <= VOTE_OPTION_MAX) {
    return (
      <span className="tally-label">
        <span className="tally-label-text">{option}</span>
        {mark}
      </span>
    );
  }
  return (
    <span className="tally-label">
      <button
        type="button"
        className={`tally-label-text tally-label-long${open ? " is-open" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={open ? undefined : "Show the whole option"}
      >
        {option}
      </button>
      {mark}
    </span>
  );
}

