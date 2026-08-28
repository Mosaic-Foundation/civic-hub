import type { VoteSummary } from "../services/api";
import { statusDisplay } from "./statusDisplay";

interface Props {
  process: VoteSummary;
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function ProcessCard({ process }: Props) {
  const isVotable = process.status === "active";
  const isDone = process.status === "closed" || process.status === "finalized";
  const isProposal = process.status === "proposed" || process.status === "threshold_met";

  return (
    <div className="process-card">
      <div className="process-card-header">
        <h3>{process.title}</h3>
        <span className={statusDisplay(process.status).className}>
          {statusDisplay(process.status).label}
        </span>
      </div>
      <div className="process-card-meta">
        {isProposal && (
          <span>{process.support_count} of {process.support_threshold} endorsements</span>
        )}
        {(isVotable || isDone) && (
          <span>{process.total_votes} vote{process.total_votes !== 1 ? "s" : ""}</span>
        )}
        {isVotable && process.closes_at && (
          <span>Closes {formatShortDate(process.closes_at)}</span>
        )}
        {isDone && process.closes_at && (
          <span>Closed {formatShortDate(process.closes_at)}</span>
        )}
        {isDone && !process.closes_at && (
          <span>Completed</span>
        )}
        {process.status === "draft" && <span>Draft</span>}
      </div>
    </div>
  );
}
