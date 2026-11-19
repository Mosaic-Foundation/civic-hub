import type { ClusterState } from "./api";
import ClusterCard from "./ClusterCard";
import "./ClusterView.css";

interface Props {
  clusters: ClusterState;
}

const MIN_PARTICIPANTS_FOR_GROUPS = 5;

export default function ClusterView({ clusters }: Props) {
  if (clusters.participant_count < MIN_PARTICIPANTS_FOR_GROUPS) {
    return (
      <div className="cluster-view">
        <div className="cluster-view-header">
          <h4 className="cluster-view-title">Opinion Groups</h4>
          <span className="cluster-view-meta">
            {clusters.participant_count} participant{clusters.participant_count !== 1 ? "s" : ""} so far
          </span>
        </div>
        <div className="cluster-view-pending">
          <p>Opinion groups need at least {MIN_PARTICIPANTS_FOR_GROUPS} participants to form. Keep sharing this conversation!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cluster-view">
      <div className="cluster-view-header">
        <h4 className="cluster-view-title">Opinion Groups</h4>
        <span className="cluster-view-meta">
          {clusters.participant_count} participant{clusters.participant_count !== 1 ? "s" : ""} &middot;{" "}
          {clusters.statement_count} statement{clusters.statement_count !== 1 ? "s" : ""} &middot;{" "}
          {clusters.groups.length} group{clusters.groups.length !== 1 ? "s" : ""}
        </span>
      </div>

      {clusters.consensus.agree.length > 0 && (
        <div className="consensus-section">
          <h5 className="consensus-heading">Broad Agreement</h5>
          <ul className="consensus-list">
            {clusters.consensus.agree.map((c) => (
              <li key={c.statement_id} className="consensus-item consensus-agree">
                <span className="consensus-text">{c.text}</span>
                <span className="consensus-rate">
                  {Math.round(c.agree_rate * 100)}% agree ({c.vote_count} vote{c.vote_count !== 1 ? "s" : ""})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="cluster-grid">
        {clusters.groups.map((g) => (
          <ClusterCard
            key={g.id}
            groupId={g.id}
            size={g.size}
            statements={g.representative_statements}
          />
        ))}
      </div>
    </div>
  );
}
