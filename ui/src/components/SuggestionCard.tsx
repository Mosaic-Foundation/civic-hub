import RichText from "./RichText";
import { useState } from "react";
import type { DraftSuggestion } from "../services/api";

/**
 * Identity for "has this been applied", by content rather than position.
 *
 * Position would key the panel and the inline Code of Conduct list
 * separately, and they render the SAME suggestions — applying in one would
 * leave the other still offering Apply.
 */
export function suggestionKey(s: DraftSuggestion): string {
  return [s.field ?? "", s.quoted_text ?? "", s.suggested_revision ?? ""].join("|");
}

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
          {suggestion.field === "seed_statements" ? (
            // Seed statements are one-per-line — render them as a numbered
            // list so the card reads the way the form's numbered rows do,
            // instead of a run-on block (Adam, 2026-09-05). Field-keyed, so
            // any type that has a seed_statements field gets it.
            <ol className="suggestion-revision-list">
              {suggestion.suggested_revision
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.length > 0)
                .map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
            </ol>
          ) : (
            <RichText className="suggestion-revision-text" text={suggestion.suggested_revision} />
          )}
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
