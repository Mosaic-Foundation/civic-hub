import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../context/AuthContext";
import SourceLinks from "../SourceLinks";
import type { DeliberationReadModel, ClusterState, VoteDirection } from "../../services/api";
import {
  getDeliberation,
  getDeliberationClusters,
  deliberationGetNext,
  deliberationVote,
  deliberationSubmitStatement,
} from "../../services/api";
import StatementCard from "./StatementCard";
import StatementSubmission from "./StatementSubmission";
import ClusterView from "./ClusterView";
import "./DeliberationPanel.css";
import RichText from "../RichText";
import SharePrompt from "../SharePrompt";

interface Props {
  processId: string;
  /** false when the page above already shows the topic as its title. */
  showTopic?: boolean;
}

type Tab = "participate" | "clusters";

export default function DeliberationPanel({ processId, showTopic }: Props) {
  const { user } = useAuth();
  const [process, setProcess] = useState<DeliberationReadModel | null>(null);
  const [clusters, setClusters] = useState<ClusterState | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [currentStatement, setCurrentStatement] = useState<{
    id: number;
    text: string;
    is_seed: boolean;
    created: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("participate");
  const [statementsVoted, setStatementsVoted] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const loadProcess = useCallback(async () => {
    try {
      const p = await getDeliberation(processId);
      setProcess(p);
      setHasSubmitted(!!p.has_submitted);
    } catch (err: any) {
      setError(err.message);
    }
  }, [processId, user?.id]);

  const loadNextStatement = useCallback(async () => {
    try {
      const result = await deliberationGetNext(processId);
      setCurrentStatement(result.statement);
    } catch {
      setCurrentStatement(null);
    }
  }, [processId]);

  const loadClusters = useCallback(async () => {
    try {
      const c = await getDeliberationClusters(processId);
      setClusters(c);
    } catch {
      setClusters(null);
    }
  }, [processId]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await loadProcess();
      await Promise.all([loadNextStatement(), loadClusters()]);
      setLoading(false);
    }
    init();
  }, [loadProcess, loadNextStatement, loadClusters]);

  async function handleVote(_statementId: number, direction: VoteDirection) {
    if (!currentStatement) return;
    await deliberationVote(processId, currentStatement.id, direction);
    setStatementsVoted((n) => n + 1);
    await loadNextStatement();
  }

  async function handleSubmitStatement(text: string) {
    await deliberationSubmitStatement(processId, text);
    setHasSubmitted(true);
  }

  if (loading) {
    return <div className="deliberation-panel-loading">Loading conversation...</div>;
  }

  if (error || !process) {
    return <div className="deliberation-panel-error">{error || "Could not load conversation"}</div>;
  }

  return (
    <div className="deliberation-panel">
      <div className="deliberation-panel-header">
        {showTopic !== false && <h3 className="deliberation-topic">{process.topic}</h3>}
        {(process.deadline || process.participation_threshold) && (
          <div className="deliberation-meta">
            {process.deadline && (
              <span className="deliberation-deadline">
                Ends {new Date(process.deadline).toLocaleDateString()}
              </span>
            )}
            {process.participation_threshold && (
              <span className="deliberation-threshold">
                Goal: {process.participation_threshold} participants
              </span>
            )}
          </div>
        )}
        <RichText className="deliberation-framing" text={process.framing} />
        <SourceLinks sources={process.sources ?? []} />
      </div>

      <div className="deliberation-tabs">
        <button
          className={`deliberation-tab ${tab === "participate" ? "deliberation-tab--active" : ""}`}
          onClick={() => setTab("participate")}
        >
          Participate
        </button>
        <button
          className={`deliberation-tab ${tab === "clusters" ? "deliberation-tab--active" : ""}`}
          onClick={() => { setTab("clusters"); loadClusters(); }}
        >
          Opinion Groups
        </button>
      </div>

      {tab === "participate" && (
        <div className="deliberation-participate">
          {statementsVoted > 0 && (
            <p className="deliberation-vote-count">
              You've voted on {statementsVoted} statement{statementsVoted !== 1 ? "s" : ""}
            </p>
          )}

          {currentStatement ? (
            <StatementCard
              key={currentStatement.id}
              statement={currentStatement}
              onVote={handleVote}
            />
          ) : (
            <div className="deliberation-no-statements">
              <p>No more statements to vote on right now.</p>
              <p>Add your own perspective below, or check back later.</p>
            </div>
          )}

          {hasSubmitted ? (
            <div className="statement-submission statement-submission--done">
              <p className="statement-submission-done-msg">
                You've already added your perspective to this conversation. Keep voting on other statements to help the community find common ground.
              </p>
            </div>
          ) : (
            <StatementSubmission onSubmit={handleSubmitStatement} />
          )}

          {/* Below the voting, so it never interrupts the flow, and only once
              taking part means something: a few votes in, or a statement of
              their own. One vote is a tap, not a commitment. */}
          {(hasSubmitted || statementsVoted >= 3) && (
            <SharePrompt
              processId={processId}
              title={process.topic}
              line="Share this conversation so more neighbors take part."
            />
          )}
        </div>
      )}

      {tab === "clusters" && clusters && <ClusterView clusters={clusters} />}
      {tab === "clusters" && !clusters && (
        <p className="deliberation-no-clusters">
          Not enough participation yet to form opinion groups.
        </p>
      )}
    </div>
  );
}
