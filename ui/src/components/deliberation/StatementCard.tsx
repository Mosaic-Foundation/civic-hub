import { useState } from "react";
import { useAction } from "../../hooks/useAction";
import type { StatementRecord, VoteDirection } from "../../services/api";
import VoteControls from "./VoteControls";
import "./StatementCard.css";

interface Props {
  statement: StatementRecord;
  onVote: (statementId: number, direction: VoteDirection) => Promise<void>;
}

export default function StatementCard({ statement, onVote }: Props) {
  const [voted, setVoted] = useState(false);
  const action = useAction("Your vote didn't go through. Please try again.");
  const voting = action.busy;

  async function handleVote(direction: VoteDirection) {
    const done = await action.run(async () => {
      await onVote(statement.id, direction);
      return true;
    });
    if (done) setVoted(true);
  }

  return (
    <div className={`statement-card ${voted ? "statement-card--voted" : ""}`}>
      {statement.is_seed && <span className="statement-seed-badge">Seed</span>}
      <p className="statement-text">{statement.text}</p>
      {!voted && <VoteControls onVote={handleVote} disabled={voting} />}
      {voting && <p className="statement-voted-label" role="status">Recording your vote...</p>}
      {action.error && <p className="statement-error-msg" role="alert">{action.error}</p>}
      {voted && <p className="statement-voted-label">Vote recorded</p>}
    </div>
  );
}
