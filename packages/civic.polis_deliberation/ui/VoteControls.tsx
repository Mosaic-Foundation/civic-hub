import type { VoteDirection } from "./api";

interface Props {
  onVote: (direction: VoteDirection) => void;
  disabled: boolean;
}

export default function VoteControls({ onVote, disabled }: Props) {
  return (
    <div className="vote-controls">
      <button
        className="vote-btn vote-agree"
        onClick={() => onVote("agree")}
        disabled={disabled}
      >
        Agree
      </button>
      <button
        className="vote-btn vote-disagree"
        onClick={() => onVote("disagree")}
        disabled={disabled}
      >
        Disagree
      </button>
      <button
        className="vote-btn vote-pass"
        onClick={() => onVote("pass")}
        disabled={disabled}
      >
        Pass
      </button>
    </div>
  );
}
