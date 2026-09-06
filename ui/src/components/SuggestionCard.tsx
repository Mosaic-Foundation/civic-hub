import RichText from "./RichText";
import { useRef, useState, useLayoutEffect } from "react";
import type { DraftSuggestion } from "../services/api";

/**
 * Identity for "has this been applied", by content rather than position.
 * Keyed on the ORIGINAL suggestion, so an in-place edit before applying does
 * not change which card is "applied", and the panel + inline CoC list (which
 * render the same suggestions) stay in sync.
 */
export function suggestionKey(s: DraftSuggestion): string {
  return [s.field ?? "", s.quoted_text ?? "", s.suggested_revision ?? ""].join("|");
}

interface Props {
  suggestion: DraftSuggestion;
  /** Applies the (possibly edited) revision. Resolves false when it could not
   *  be applied — e.g. a chunk edit whose quoted passage is no longer in the
   *  field — so the card can say so instead of showing "Applied". */
  onApply?: (revision: string) => void | Promise<boolean>;
  onDismiss?: () => void;
  applied?: boolean;
}

function grow(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

export default function SuggestionCard({ suggestion, onApply, onDismiss, applied: appliedProp }: Props) {
  const isHard = suggestion.severity === "hard";
  const [appliedLocal, setAppliedLocal] = useState(false);
  const applied = appliedProp ?? appliedLocal;

  // Edit-in-place, BEFORE applying; the card locks after (Apply appends within
  // a chunk-less field, so a second apply of an edited card would duplicate).
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(suggestion.suggested_revision ?? "");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (editing) grow(textareaRef.current);
  }, [editing, draftText]);

  const revision = suggestion.suggested_revision;
  const isSeedList = suggestion.field === "seed_statements";
  // A chunk edit targets a specific passage; render it as old → new so the
  // rest of a long field is never redrawn (the mobile-friendly case).
  const isChunkEdit = Boolean(suggestion.quoted_text && revision);

  async function handleApply() {
    setError(null);
    const ok = await onApply?.(editing ? draftText : (revision ?? ""));
    if (ok === false) {
      setError(
        "Couldn't find this passage in the field — it may have changed since. Edit the field directly, or ask me for a fresh suggestion.",
      );
      return;
    }
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

      {/* A bare quote (no replacement) — e.g. "remove this". A chunk edit
          shows the quote inside the diff instead, so don't repeat it here. */}
      {suggestion.quoted_text && !isChunkEdit && (
        <blockquote className="suggestion-quote">{suggestion.quoted_text}</blockquote>
      )}

      <p className="suggestion-message">{suggestion.message}</p>

      {revision && (
        <div className="suggestion-revision">
          <span className="suggestion-revision-label">
            {isChunkEdit ? "Suggested change:" : "Suggested:"}
          </span>
          {editing ? (
            <textarea
              ref={textareaRef}
              className="suggestion-revision-edit"
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              aria-label="Edit the suggestion before applying"
            />
          ) : isChunkEdit ? (
            // Only the changed passage: what's removed, then what replaces it.
            <div className="suggestion-diff">
              <del className="suggestion-diff-old">{suggestion.quoted_text}</del>
              <ins className="suggestion-diff-new">{revision}</ins>
            </div>
          ) : isSeedList ? (
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

      {error && <p className="suggestion-error">{error}</p>}

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
        {revision && onApply && !applied && (
          editing ? (
            <button
              type="button"
              className="suggestion-action-btn suggestion-dismiss"
              onClick={() => { setEditing(false); setError(null); }}
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
