import RichText from "./RichText";
import { useState } from "react";
import type { DraftSuggestion } from "../services/api";

interface Props {
  suggestion: DraftSuggestion;
  onApply?: () => void;
  onDismiss?: () => void;
  /** Controlled "already applied" state. Pass it where the answer has to
   *  outlive this component — the drafting panel unmounts every time someone
   *  switches to the form, and local state took the applied cards with it.
   *  Omitted, the card falls back to remembering it itself. */
  applied?: boolean;
}

export default function SuggestionCard({ suggestion, onApply, onDismiss, applied: appliedProp }: Props) {
  const isHard = suggestion.severity === "hard";
  const [appliedLocal, setAppliedLocal] = useState(false);
  const applied = appliedProp ?? appliedLocal;

  function handleApply() {
    if (onApply) onApply();
    setAppliedLocal(true);
  }

  return (
    <div className={`suggestion-card ${isHard ? "suggestion-hard" : "suggestion-soft"}${applied ? " suggestion-applied" : ""}`}>
      <div className="suggestion-header">
        <span className={`suggestion-badge ${isHard ? "badge-hard" : "badge-soft"}`}>
          {isHard ? "Must fix" : "Suggestion"}
        </span>
        {suggestion.field && (
          <span className="suggestion-field">{suggestion.field}</span>
        )}
      </div>

      {suggestion.quoted_text && (
        <blockquote className="suggestion-quote">
          {suggestion.quoted_text}
        </blockquote>
      )}

      <p className="suggestion-message">{suggestion.message}</p>

      {suggestion.suggested_revision && (
        <div className="suggestion-revision">
          <span className="suggestion-revision-label">Suggested:</span>
          <RichText className="suggestion-revision-text" text={suggestion.suggested_revision} />
        </div>
      )}

      <div className="suggestion-actions">
        {suggestion.suggested_revision && onApply && (
          <button
            type="button"
            className={`suggestion-action-btn ${applied ? "suggestion-applied-btn" : "suggestion-apply"}`}
            onClick={handleApply}
            disabled={applied}
          >
            {applied ? "Applied" : "Apply"}
          </button>
        )}
        {!isHard && onDismiss && !applied && (
          <button
            type="button"
            className="suggestion-action-btn suggestion-dismiss"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
