import { useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
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

interface Props {
  processId: string;
  /** false when the page above already shows the topic as its title. */
  showTopic?: boolean;
  /** Fires once the viewer has taken part enough to be worth asking to
   *  share — their own statement, or three votes. The page owns the share
   *  bar, so the signal has to travel up to it. */
  onParticipated?: () => void;
  /** Rendered directly under the statement being voted on — the page owns
   *  what goes here (today: the share moment) so the panel stays free of
   *  share concerns. Placed HERE and not after the panel because the vote
   *  buttons are already below the fold on a phone; anything under the whole
   *  panel would land further down still, which is the exact mistake the
   *  share row at the top of the page was making. */
  afterVoting?: ReactNode;
}

type Tab = "participate" | "clusters";

export default function DeliberationPanel({ processId, showTopic, onParticipated, afterVoting }: Props) {
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

  // One vote is a tap, not a commitment; three, or a statement of their
  // own, is taking part.
  useEffect(() => {
    if (hasSubmitted || statementsVoted >= 3) onParticipated?.();
  }, [hasSubmitted, statementsVoted, onParticipated]);

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

          {afterVoting}

          {hasSubmitted ? (
            <div className="statement-submission statement-submission--done">
              <p className="statement-submission-done-msg">
                You've already added your perspective to this conversation. Keep voting on other statements to help the community find common ground.
              </p>
            </div>
          ) : (
            <StatementSubmission onSubmit={handleSubmitStatement} />
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
