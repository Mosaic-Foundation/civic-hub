// Feedback page — single form for any kind of product input.
//
// Open to anonymous and signed-in users. Signed-in users have email
// pre-filled and read-only; anonymous users may leave name + email
// blank, in which case the operator has no follow-up address. A
// honeypot input (.fb-honeypot, hidden via CSS + tabIndex=-1) catches
// dumb bots — real users never see it.
//
// The form asks one plain question first (feedback routing, Adam's design,
// 2026-10-08): is this about this hub's content or community, or about how
// the site works? The pills underneath are that side's only. Everything goes
// to the hub's admins; Bug and Idea are also shared with Civic.Social, which
// maintains the software, and the form says so before sending. The sender's
// address goes with that copy only if they tick the consent box. The page
// they came from goes with every report (services/lastPage.ts); the server
// adds the software version, and the browser is the request's user agent.
//
// On submit failure (network down, server 500), we surface the
// hub's feedback address (hub.feedback_email: its own, else its contact
// address, else the platform's) alongside the error so the user can still
// get the message through.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { submitFeedback, uploadFeedbackScreenshot, type FeedbackCategory } from "../services/api";
import { lastPage } from "../services/lastPage";
import PostImagePicker from "../components/PostImagePicker";
import hub from "../config/hub";
import "./Feedback.css";

type Side = "hub" | "software";

const SIDES: ReadonlyArray<{ value: Side; label: string; hint: string }> = [
  {
    value: "hub",
    label: "This hub",
    hint: "Its content or community: wrong information, a topic, moderation, a local request.",
  },
  {
    value: "software",
    label: "How the site works",
    hint: "Something broken or confusing, or an idea for the software.",
  },
];

const CATEGORIES: ReadonlyArray<{
  value: FeedbackCategory;
  side: Side;
  label: string;
  hint: string;
}> = [
  { value: "bug", side: "software", label: "Bug", hint: "Something is broken or not working as expected" },
  { value: "idea", side: "software", label: "Idea", hint: "A feature or improvement you'd like to see" },
  {
    value: "topic",
    side: "hub",
    label: "Suggest a topic",
    hint: "A topic the Hub should discuss, for when you'd rather suggest an issue than start a process yourself",
  },
  { value: "moderation", side: "hub", label: "Moderation", hint: "Flag content or behavior for the admins" },
  { value: "general", side: "hub", label: "General", hint: "Anything else: questions, thoughts, comments" },
];

/** What the form says before a software report is sent (Adam, 2026-10-08). */
const SHARED_NOTICE =
  "Reports about how the site works are also shared with Civic.Social, which maintains the software.";

const MESSAGE_MAX_LEN = 4000;

export default function Feedback() {
  const { user } = useAuth();
  const [side, setSide] = useState<Side | null>(null);
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [contactOk, setContactOk] = useState(false);
  // Read once: the page the person was on when they opened the form.
  const [pagePath] = useState(() => lastPage());
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  // A screenshot for a bug report — offered only to signed-in users, since
  // the upload route requires one (Adam, 2026-09-07). Kept if the person
  // switches category and back; sent only with a bug report.
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<null | { shared: boolean }>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!category) {
      setError("Please choose what this is about.");
      return;
    }
    if (!message.trim()) {
      setError("Please enter a message.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await submitFeedback({
        category,
        message: message.trim(),
        name: user ? null : name.trim() || null,
        email: user ? null : email.trim() || null, // signed-in path uses user_id; backend has the email
        website: website || undefined,
        screenshot_url: category === "bug" && user ? screenshotUrl : null,
        page_path: pagePath,
        contact_ok: side === "software" && canConsent && contactOk,
      });
      setSubmitted({ shared: res.shared_with_civic_social === true });
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
            The hub's admins have your message. If you left an email, they'll
            follow up when they can.
          </p>
          {submitted.shared && (
            <p className="feedback-success" data-testid="feedback-shared">
              It was also shared with Civic.Social, which maintains the software.
              {contactOk ? " They may contact you about it, and will tell you when it's fixed." : ""}
            </p>
          )}
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
  // Consent only means something with an address to share.
  const canConsent = Boolean(user) || email.trim().length > 0;

  function chooseSide(next: Side) {
    setSide(next);
    // The pill always agrees with the side: picking a side picks its first.
    if (!category || CATEGORIES.find((c) => c.value === category)?.side !== next) {
      setCategory(CATEGORIES.find((c) => c.side === next)!.value);
    }
  }

  return (
    <div className="page feedback-page">
      <div className="feedback-body">
        <h1>Send feedback</h1>
        <p className="feedback-subtitle">
          Ideas, topics the Hub should take up, bug reports, moderation
          flags, or general thoughts: all welcome. The hub's admins read
          everything.
        </p>

        <form className="feedback-form" onSubmit={handleSubmit}>
          <fieldset className="form-field feedback-side">
            <legend className="form-label">What is this about?</legend>
            <div className="feedback-side-row">
              {SIDES.map((s) => (
                <label key={s.value} className={`feedback-side-card${side === s.value ? " is-selected" : ""}`}>
                  <input
                    type="radio"
                    name="feedback-side"
                    value={s.value}
                    checked={side === s.value}
                    onChange={() => chooseSide(s.value)}
                    disabled={submitting}
                  />
                  <span className="feedback-side-label">{s.label}</span>
                  <span className="feedback-side-hint">{s.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {side && (
          <>
          <div className="form-field">
            <span className="form-label" id="feedback-category-label">
              What kind?
            </span>
            <div className="feedback-category-row" role="radiogroup" aria-labelledby="feedback-category-label">
              {CATEGORIES.filter((c) => c.side === side).map((c) => (
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

          {category === "bug" && (
            <div className="form-field">
              <label className="form-label">
                Screenshot <span className="optional">(optional — it really helps)</span>
              </label>
              {user ? (
                <>
                  <p className="form-hint">
                    A picture of what you saw saves a lot of back-and-forth.
                    Anything on the screen you'd rather not share, crop out first.
                  </p>
                  <PostImagePicker
                    imageUrl={screenshotUrl}
                    imageAlt={null}
                    hideAlt
                    addLabel="Add screenshot"
                    onChange={(next) => setScreenshotUrl(next.image_url)}
                    disabled={submitting}
                    uploadFn={uploadFeedbackScreenshot}
                  />
                </>
              ) : (
                <p className="form-hint">
                  Sign in to attach a screenshot. You can still describe what
                  happened below.
                </p>
              )}
            </div>
          )}

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
              Signed in as <strong>{user.email}</strong>. The hub's admins see
              your account, so they can follow up if needed.
            </p>
          )}

          {side === "software" && (
            <div className="feedback-shared" data-testid="feedback-shared-notice">
              <p className="feedback-shared-notice">{SHARED_NOTICE}</p>
              {canConsent ? (
                <label className="feedback-consent">
                  <input
                    type="checkbox"
                    checked={contactOk}
                    onChange={(e) => setContactOk(e.target.checked)}
                    disabled={submitting}
                  />
                  <span>Civic.Social may contact me about this</span>
                </label>
              ) : (
                <p className="form-hint">Leave an email above if Civic.Social may contact you about it.</p>
              )}
              <p className="form-hint">
                {canConsent ? "Your email goes to Civic.Social only if you tick this. " : ""}The page you were on, your
                browser and the software's version go with the report.
              </p>
            </div>
          )}
          </>
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
              <a href={`mailto:${hub.feedback_email}`}>Email us instead.</a>
            </p>
          )}

          <button
            type="submit"
            className="feedback-submit-button"
            disabled={submitting || !category || !message.trim()}
          >
            {submitting ? "Sending…" : "Send feedback"}
          </button>
        </form>

        <p className="feedback-fallback">
          Prefer email?{" "}
          <a href={`mailto:${hub.feedback_email}`}>{hub.feedback_email}</a>
        </p>
      </div>
    </div>
  );
}
