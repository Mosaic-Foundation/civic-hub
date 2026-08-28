import type { ProposalSummary } from "../services/api";
import { statusDisplay } from "./statusDisplay";

interface Props {
  proposal: ProposalSummary;
}

export default function ProposalCard({ proposal }: Props) {
  const remaining = proposal.support_threshold - proposal.support_count;
  const pct = Math.round(
    (proposal.support_count / proposal.support_threshold) * 100
  );
  const isPromoted = proposal.status === "closed";

  return (
    <div className="proposal-card">
      <div className="proposal-card-header">
        <h3>{proposal.title}</h3>
        {(() => {
          const d = statusDisplay(isPromoted ? "promoted" : "gathering");
          return <span className={d.className}>{d.label}</span>;
        })()}
      </div>

      {!isPromoted && (
        <>
          <div className="proposal-progress">
            <div className="proposal-progress-track">
              <div
                className="proposal-progress-fill"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="proposal-progress-label">
              {proposal.support_count} of {proposal.support_threshold} endorsements
            </span>
          </div>
          <p className="proposal-needs">
            Needs {remaining} more endorsement{remaining !== 1 ? "s" : ""} to become an official vote
          </p>
        </>
      )}

      {isPromoted && (
        <p className="proposal-promoted-text">
          Promoted to official vote
        </p>
      )}
    </div>
  );
}
