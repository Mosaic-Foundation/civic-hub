import { useState } from "react";
import "./StatementSubmission.css";

interface Props {
  onSubmit: (text: string) => Promise<void>;
}

const MAX_CHARS = 280;

export default function StatementSubmission({ onSubmit }: Props) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // The server's refusal, shown under the box. A statement can be refused
  // by the word list (a slur, a swear) or by Polis; before this the failure
  // was silent — try/finally with no catch — so the text just sat there
  // (Adam, 2026-09-06: "no error letting the user know that the seed
  // statement wasn't submitted like on the other processes").
  const [error, setError] = useState<string | null>(null);

  const remaining = MAX_CHARS - text.length;

  async function handleSubmit() {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(text.trim());
      setText("");
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit your statement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="statement-submission">
      <h4 className="statement-submission-title">Add your perspective</h4>
      <textarea
        className="statement-submission-input"
        value={text}
        onChange={(e) => {
          setText(e.target.value.slice(0, MAX_CHARS));
          if (error) setError(null);
        }}
        placeholder="Write a short statement for others to vote on..."
        rows={3}
        disabled={submitting}
      />
      <div className="statement-submission-footer">
        <span className={`char-count ${remaining < 20 ? "char-count--low" : ""}`}>
          {remaining} characters remaining
        </span>
        <button
          className="statement-submit-btn"
          onClick={handleSubmit}
          disabled={!text.trim() || submitting}
        >
          {submitting ? "Submitting..." : "Submit Statement"}
        </button>
      </div>
      {error && (
        <p className="statement-error-msg" role="alert">
          {error}
        </p>
      )}
      {submitted && (
        <p className="statement-submitted-msg">
          Statement submitted. It may be moderated before appearing.
        </p>
      )}
    </div>
  );
}
