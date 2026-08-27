// Feedback page — single form for any kind of product input.
//
// Open to anonymous and signed-in users. Signed-in users have email
// pre-filled and read-only; anonymous users may leave name + email
// blank, in which case the operator has no follow-up address. A
// honeypot input (.fb-honeypot, hidden via CSS + tabIndex=-1) catches
// dumb bots — real users never see it.
//
// On submit failure (network down, server 500), we surface the
// mailto:contact@civic.social escape hatch alongside the error so the
// user can still get the message through.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { submitFeedback, type FeedbackCategory } from "../services/api";
import "./Feedback.css";

const OPERATOR_EMAIL = "contact@civic.social";

const CATEGORIES: ReadonlyArray<{
  value: FeedbackCategory;
  label: string;
  hint: string;
}> = [
  { value: "idea", label: "Idea", hint: "A feature or improvement you'd like to see" },
  {
    value: "topic",
    label: "Suggest a topic",
    hint: "A topic the Hub should discuss — for when you'd rather suggest an issue than start a process yourself",
  },
  { value: "bug", label: "Bug", hint: "Something is broken or not working as expected" },
  { value: "moderation", label: "Moderation", hint: "Flag content or behavior for the operator" },
  { value: "general", label: "General", hint: "Anything else — questions, thoughts, comments" },
];

const MESSAGE_MAX_LEN = 4000;

export default function Feedback() {
  const { user } = useAuth();
  const [category, setCategory] = useState<FeedbackCategory>("idea");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) {
      setError("Please enter a message.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await submitFeedback({
        category,
        message: message.trim(),
        name: user ? null : name.trim() || null,
        email: user ? null : email.trim() || null, // signed-in path uses user_id; backend has the email
        website: website || undefined,
      });
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't send feedback. Please try emailing us directly.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="page feedback-page">
        <div className="feedback-body">
          <h1>Thanks for the feedback</h1>
          <p className="feedback-success">
            We received your message. If you left an email, we'll follow up
            when we can.
          </p>
          <p>
            <Link to="/" className="feedback-back-link">
              &larr; Back to the feed
            </Link>
          </p>
        </div>
      </div>
    );
  }

  const remaining = MESSAGE_MAX_LEN - message.length;

  return (
    <div className="page feedback-page">
      <div className="feedback-body">
        <h1>Send feedback</h1>
        <p className="feedback-subtitle">
          Ideas, topics the Hub should take up, bug reports, moderation
          flags, or general thoughts — all welcome. We read everything.
        </p>

        <form className="feedback-form" onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label" htmlFor="feedback-category">
              What kind of feedback?
            </label>
            <div className="feedback-category-row" role="radiogroup" aria-label="Category">
              {CATEGORIES.map((c) => (
                <label
                  key={c.value}
                  className={`feedback-category-pill${
                    category === c.value ? " is-selected" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="feedback-category"
                    value={c.value}
                    checked={category === c.value}
                    onChange={() => setCategory(c.value)}
                    disabled={submitting}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
            <p className="form-hint">
              {CATEGORIES.find((c) => c.value === category)?.hint}
            </p>
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="feedback-message">
              Message <span className="required">*</span>
            </label>
            <textarea
              id="feedback-message"
              className="form-textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us what's on your mind…"
              rows={6}
              maxLength={MESSAGE_MAX_LEN}
              disabled={submitting}
              required
            />
            <p className="form-hint feedback-counter">
              {remaining.toLocaleString()} characters remaining
            </p>
          </div>

          {!user && (
            <>
              <div className="form-field">
                <label className="form-label" htmlFor="feedback-name">
                  Your name <span className="optional">(optional)</span>
                </label>
                <input
                  id="feedback-name"
                  type="text"
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={200}
                  disabled={submitting}
                  autoComplete="name"
                />
              </div>

              <div className="form-field">
                <label className="form-label" htmlFor="feedback-email">
                  Email <span className="optional">(optional)</span>
                </label>
                <input
                  id="feedback-email"
                  type="email"
                  className="form-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="So we can reply if needed"
                  maxLength={320}
                  disabled={submitting}
                  autoComplete="email"
                />
              </div>
            </>
          )}

          {user && (
            <p className="feedback-signed-in">
              Signed in as <strong>{user.email}</strong>. We'll attach this
              feedback to your account so we can follow up if needed.
            </p>
          )}

          {/* Honeypot — visible only to bots. Real users never tab here
              (tabIndex=-1) and the input is hidden off-screen via CSS. */}
          <div className="fb-honeypot" aria-hidden="true">
            <label htmlFor="feedback-website">Website</label>
            <input
              id="feedback-website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>

          {error && (
            <p className="form-error">
              {error}{" "}
              <a href={`mailto:${OPERATOR_EMAIL}`}>Email us instead.</a>
            </p>
          )}

          <button
            type="submit"
            className="feedback-submit-button"
            disabled={submitting || !message.trim()}
          >
            {submitting ? "Sending…" : "Send feedback"}
          </button>
        </form>

        <p className="feedback-fallback">
          Prefer email?{" "}
          <a href={`mailto:${OPERATOR_EMAIL}`}>{OPERATOR_EMAIL}</a>
        </p>
      </div>
    </div>
  );
}
