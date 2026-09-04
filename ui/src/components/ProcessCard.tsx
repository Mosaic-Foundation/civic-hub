import type { VoteSummary } from "../services/api";
import { statusDisplay } from "./statusDisplay";
import { typeColorSlug } from "./typeColor";
import { friendlyType } from "./ProcessLinkPicker";

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
      {/* Header carries the TYPE, like the feed's cards; the status pill
          moved to the footer, across from the date (Adam, 2026-09-04). The
          label is the bare type — "Vote", not the feed's "New vote" — since
          nothing here is new by definition. */}
      <div className="process-card-header">
        <h3>{process.title}</h3>
        <span className={`feed-pill feed-pill--type-${typeColorSlug("civic.vote")}`}>
          {friendlyType("civic.vote")}
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
        <span className={statusDisplay(process.status).className}>
          {statusDisplay(process.status).label}
        </span>
      </div>
    </div>
  );
}
