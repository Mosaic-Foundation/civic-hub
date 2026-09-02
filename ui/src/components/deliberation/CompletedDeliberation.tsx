import type { DeliberationReadModel } from "../../services/api";
import SourceLinks from "../SourceLinks";
import "./CompletedDeliberation.css";

interface Props {
  process: DeliberationReadModel;
  /** false when the page above already shows the topic as its title. */
  showTopic?: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function CompletedDeliberation({ process: proc, showTopic }: Props) {
  const summary = proc.summary;

  return (
    <div className="completed-deliberation">
      <div className="completed-header">
        {showTopic !== false && <h4 className="completed-topic">{proc.topic}</h4>}
        <span className="completed-badge">Completed</span>
      </div>

      <SourceLinks sources={proc.sources ?? []} />

      {!summary && (
        <p className="completed-no-summary">
          {proc.summary_status === "failed"
            ? "Summary generation failed."
            : "Summary pending..."}
        </p>
      )}

      {summary && (
        <>
          <p className="completed-summary-text">{summary.summary_text}</p>

          <div className="completed-stats">
            <span>{summary.participation_stats.total_participants} participants</span>
            <span>{summary.participation_stats.total_statements} statements</span>
            <span>{summary.participation_stats.opinion_groups_formed} opinion groups</span>
          </div>

          {summary.directed_questions.length > 0 && (
            <div className="completed-questions">
              <h5 className="completed-section-title">Directed Questions</h5>
              <ol className="completed-questions-list">
                {summary.directed_questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ol>
            </div>
          )}

          {summary.top_consensus_statements.length > 0 && (
            <div className="completed-consensus">
              <h5 className="completed-section-title">Consensus Statements</h5>
              <ul className="completed-consensus-list">
                {summary.top_consensus_statements.map((cs, i) => (
                  <li key={i} className="completed-consensus-item">
                    <span className="completed-consensus-text">{cs.statement_text}</span>
                    <span className="completed-consensus-rate">
                      {Math.round(cs.agree_rate * 100)}% ({cs.vote_count} votes)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.opinion_groups.length > 0 && (
            <div className="completed-groups">
              <h5 className="completed-section-title">Opinion Groups</h5>
              <div className="completed-groups-grid">
                {summary.opinion_groups.map((g) => (
                  <div key={g.group_id} className="completed-group-card">
                    <span className="completed-group-name">Group {g.group_id}</span>
                    <span className="completed-group-size">{g.size} participants</span>
                    <ul className="completed-group-statements">
                      {g.representative_statements.map((rs, i) => (
                        <li key={i} className="completed-group-stmt">{rs.text}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="completed-methodology">
            <span>
              Methodology: {summary.methodology.prompt_version} &middot;{" "}
              {summary.methodology.model_used} &middot;{" "}
              {formatDate(summary.methodology.generated_at)}
            </span>
            {summary.linked_polis_data_uri && (
              <a
                href={summary.linked_polis_data_uri}
                target="_blank"
                rel="noopener noreferrer"
                className="completed-data-link"
              >
                View raw data
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}
