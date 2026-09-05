import RichText from "./RichText";
import { useRef, useState, useLayoutEffect } from "react";
import type { DraftSuggestion } from "../services/api";

/**
 * Identity for "has this been applied", by content rather than position.
 *
 * Position would key the panel and the inline Code of Conduct list
 * separately, and they render the SAME suggestions — applying in one would
 * leave the other still offering Apply. Keyed on the ORIGINAL suggestion, so
 * an in-place edit before applying does not change which card is "applied".
 */
export function suggestionKey(s: DraftSuggestion): string {
  return [s.field ?? "", s.quoted_text ?? "", s.suggested_revision ?? ""].join("|");
}

interface Props {
  suggestion: DraftSuggestion;
  /** Applies the (possibly edited) revision text. */
  onApply?: (revision: string) => void;
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

  // Edit-in-place, BEFORE applying. Once applied the card locks (no Edit, no
  // re-apply) — Apply appends to a non-empty field, so a second apply of an
  // edited card would duplicate what the first one wrote (Adam, 2026-09-05).
  // Further changes are made in the form, where the field is directly editable.
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(suggestion.suggested_revision ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing, draftText]);

  const revision = suggestion.suggested_revision;
  const isSeedList = suggestion.field === "seed_statements";

  function handleApply() {
    onApply?.(editing ? draftText : (revision ?? ""));
    setAppliedLocal(true);
    setEditing(false);
  }

  function startEditing() {
    setDraftText(revision ?? "");
    setEditing(true);
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

      {revision && (
        <div className="suggestion-revision">
          <span className="suggestion-revision-label">Suggested:</span>
          {editing ? (
            // Clean, unnumbered, line breaks preserved — one statement/source
            // per line, so trimming is just deleting a line.
            <textarea
              ref={textareaRef}
              className="suggestion-revision-edit"
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              aria-label="Edit the suggestion before applying"
            />
          ) : isSeedList ? (
            // Seed statements are one-per-line — a numbered list matching the
            // form's rows, instead of a run-on block.
            <ol className="suggestion-revision-list">
              {revision
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.length > 0)
                .map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
            </ol>
          ) : (
            <RichText className="suggestion-revision-text" text={revision} />
          )}
        </div>
      )}

      <div className="suggestion-actions">
        {revision && onApply && (
          <button
            type="button"
            className={`suggestion-action-btn ${applied ? "suggestion-applied-btn" : "suggestion-apply"}`}
            onClick={handleApply}
            disabled={applied || (editing && draftText.trim().length === 0)}
          >
            {applied ? "Applied" : "Apply"}
          </button>
        )}
        {/* Edit / Cancel — only before applying. */}
        {revision && onApply && !applied && (
          editing ? (
            <button
              type="button"
              className="suggestion-action-btn suggestion-dismiss"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="suggestion-action-btn suggestion-dismiss"
              onClick={startEditing}
            >
              Edit
            </button>
          )
        )}
        {!isHard && onDismiss && !applied && !editing && (
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
