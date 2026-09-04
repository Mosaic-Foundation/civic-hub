// Vote list card — a thin wrapper over the shared ProcessListCard so the
// vote's meta line lives with the vote, and the card's shape lives in one
// place for every type.

import type { VoteSummary } from "../services/api";
import ProcessListCard, { cardDate } from "./ProcessListCard";

interface Props {
  process: VoteSummary;
}

export default function ProcessCard({ process }: Props) {
  const isVotable = process.status === "active";
  const isDone = process.status === "closed" || process.status === "finalized";
  const isProposal = process.status === "proposed" || process.status === "threshold_met";
  const closes = cardDate(process.closes_at);

  return (
    <ProcessListCard
      processType="civic.vote"
      status={process.status}
      title={process.title}
      meta={[
        cardDate(process.created_at),
        isProposal
          ? `${process.support_count} of ${process.support_threshold} endorsements`
          : (isVotable || isDone)
            ? `${process.total_votes} vote${process.total_votes !== 1 ? "s" : ""}`
            : null,
        isDone
          ? closes && `closed ${closes}`
          : closes && `closes ${closes}`,
      ]}
    />
  );
}
