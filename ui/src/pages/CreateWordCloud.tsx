import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { createWordcloudProcess } from "../services/api";
import "./CreateWordCloud.css";

const TITLE_MAX = 200;
const DESC_MAX = 1000;
const PROMPT_MAX = 500;

export default function CreateWordCloud() {
  const navigate = useNavigate();
  const { isAdmin, loading: authLoading } = useAuth();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [promptText, setPromptText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (authLoading) {
    return (
      <div className="page create-wordcloud-page">
        <p className="create-wordcloud-status">Loading...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="page create-wordcloud-page">
        <Link to="/" className="back-link">&larr; Home</Link>
        <h1>Not available</h1>
        <p>Only admins can create word clouds.</p>
      </div>
    );
  }

  const canSubmit =
    title.trim().length > 0 &&
    promptText.trim().length > 0 &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await createWordcloudProcess({
        title: title.trim(),
        description: description.trim(),
        promptText: promptText.trim(),
      });
      navigate(`/wordcloud/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create word cloud");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page create-wordcloud-page">
      <Link to="/" className="back-link">&larr; Home</Link>
      <h1>Create a word cloud</h1>
      <p className="create-wordcloud-lede">
        Ask residents an open-ended question. Their responses aggregate into a
        live word cloud visible to everyone.
      </p>

      <form onSubmit={handleSubmit} className="create-wordcloud-form">
        <div className="form-field">
          <label className="form-label" htmlFor="wc-title">
            Title <span className="required">*</span>
          </label>
          <input
            id="wc-title"
            className="form-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
            maxLength={TITLE_MAX}
            placeholder="e.g. What do you love about where you live?"
            disabled={submitting}
          />
          <span className="form-counter">
            {title.length} / {TITLE_MAX}
          </span>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="wc-description">
            Description <span className="optional">(optional)</span>
          </label>
          <textarea
            id="wc-description"
            className="form-textarea form-textarea-small"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, DESC_MAX))}
            maxLength={DESC_MAX}
            rows={3}
            placeholder="Brief context for participants — why you're asking."
            disabled={submitting}
          />
          <span className="form-counter">
            {description.length} / {DESC_MAX}
          </span>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="wc-prompt">
            Prompt <span className="required">*</span>
          </label>
          <p className="form-hint">
            The question residents will answer. Keep it open-ended — one or two
            sentences works best.
          </p>
          <textarea
            id="wc-prompt"
            className="form-textarea form-textarea-small"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value.slice(0, PROMPT_MAX))}
            maxLength={PROMPT_MAX}
            rows={2}
            placeholder="e.g. In a few words, what makes this community special?"
            disabled={submitting}
          />
          <span className="form-counter">
            {promptText.length} / {PROMPT_MAX}
          </span>
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="create-wordcloud-actions">
          <button
            type="submit"
            className="create-wordcloud-submit"
            disabled={!canSubmit}
          >
            {submitting ? "Creating..." : "Create & activate"}
          </button>
        </div>
      </form>
    </div>
  );
}
