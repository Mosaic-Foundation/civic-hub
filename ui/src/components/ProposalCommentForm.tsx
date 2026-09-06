import { useState } from "react";
import { submitInput } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useRequireAuth } from "../hooks/useRequireAuth";
import { useCommentIdentityMode } from "../hooks/useCommentIdentityMode";
import AuthModal from "./AuthModal";
import MarkdownTextarea from "./MarkdownTextarea";

const COMMENT_MAX = 500;
const UPDATE_MAX = 4000;

// The one comment form for every process type (its name predates that).
// With `phase="update"` it posts a creator's update: no anonymity toggle,
// a longer limit, the Markdown toolbar — same server path, same word list,
// same admin hide.
interface Props {
  /** The process being commented on — a proposal, vote, project, conversation. */
  proposalId: string;
  onCommentAdded: () => void;
  phase?: "update";
  heading?: string;
  placeholder?: string;
  submitLabel?: string;
}

export default function ProposalCommentForm({
  proposalId,
  onCommentAdded,
  phase,
  heading,
  placeholder,
  submitLabel,
}: Props) {
  const isUpdate = phase === "update";
  const max = isUpdate ? UPDATE_MAX : COMMENT_MAX;
  const { actorId } = useAuth();
  const { requireAuth, showAuthModal, closeAuthModal, handleAuthComplete } = useRequireAuth();
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const identityMode = useCommentIdentityMode();

  async function doSubmit() {
    if (!actorId || body.trim().length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitInput(
        proposalId,
        body.trim(),
        !isUpdate && (identityMode === "anonymous_only" || anonymous),
        phase,
      );
      setBody("");
      setSuccess(true);
      onCommentAdded();
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit comment");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    requireAuth(() => doSubmit());
  }

  return (
    <div className="proposal-comment-form">
      {showAuthModal && (
        <AuthModal onComplete={handleAuthComplete} onDismiss={closeAuthModal} />
      )}

      <h3>{heading ?? "Add a comment"}</h3>

      <form onSubmit={handleSubmit}>
        {isUpdate ? (
          <MarkdownTextarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, max))}
            placeholder={placeholder ?? "Share an update on your project..."}
            maxLength={max}
            disabled={submitting}
          />
        ) : (
          <textarea
            className="vote-comment-textarea"
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, max))}
            placeholder={placeholder ?? "Share your thoughts on this proposal"}
            rows={3}
            maxLength={max}
            disabled={submitting}
          />
        )}
        {!isUpdate && identityMode === "anonymous_optional" && body.trim().length > 0 && (
          <label className="auth-checkbox-label comment-anonymous-toggle">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
              disabled={submitting}
            />
            <span>Post my comment anonymously</span>
          </label>
        )}
        <div className="proposal-comment-form-footer">
          <span className="vote-comment-counter">
            {body.length} / {max}
          </span>
          <button
            type="submit"
            className="endorse-button"
            disabled={submitting || body.trim().length === 0}
          >
            {submitting ? "Submitting..." : (submitLabel ?? "Submit Comment")}
          </button>
        </div>
      </form>

      {success && <p className="vote-confirmation">{isUpdate ? "Update posted." : "Comment submitted."}</p>}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
