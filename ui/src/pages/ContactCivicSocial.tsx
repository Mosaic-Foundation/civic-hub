// Contact Civic.Social (feedback routing, 2026-10-13): a hub admin writes to
// Civic.Social, which maintains the software, directly. Apart from
// residents' feedback: it never shows on the hub's Feedback tab, and it is
// here whether or not the Feedback plugin is on. The admin's address goes
// with it, and the page says so.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/authState";
import { contactCivicSocial } from "../services/api";
import { lastPage } from "../services/lastPage";
import { useHub } from "../config/hub";
import HelpButton from "../components/HelpButton";
import "./Feedback.css";

const MESSAGE_MAX_LEN = 4000;

export default function ContactCivicSocial() {
  const hub = useHub();
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [pagePath] = useState(() => lastPage());
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setError(null);
    try {
      await contactCivicSocial({ message: message.trim(), page_path: pagePath });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="page admin-page" id="contact-civic-social">
      <div className="feedback-body">
        <h1 className="contact-civic-social-title kit-page-title">
          Contact Civic.Social
          <HelpButton k="admin.contact_civic_social" label="Contact Civic.Social" />
        </h1>
        {sent ? (
          <>
            <p className="feedback-success" role="status">
              Sent. Civic.Social will reply to {user?.email ?? "your address"}.
            </p>
            <p>
              <button type="button" className="feedback-again" onClick={() => { setMessage(""); setSent(false); }}>
                Write another
              </button>
            </p>
          </>
        ) : (
          <>
            <p className="feedback-subtitle kit-page-lede">
              Write to Civic.Social, which maintains the software this hub runs on: a question about running the hub,
              a problem, or a request. This is separate from your residents' feedback.
            </p>
            <form className="feedback-form" onSubmit={handleSubmit}>
              <div className="form-field">
                <label className="form-label" htmlFor="contact-message">
                  Message <span className="required">*</span>
                </label>
                <textarea
                  id="contact-message"
                  className="form-textarea"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={6}
                  maxLength={MESSAGE_MAX_LEN}
                  disabled={sending}
                  required
                />
              </div>
              <p className="feedback-signed-in">
                Civic.Social will see your address, <strong>{user?.email}</strong>, and this hub's name, so they can
                reply.
              </p>
              {error && <p className="form-error">{error}</p>}
              <button type="submit" className="feedback-submit-button" disabled={sending || !message.trim()}>
                {sending ? "Sending…" : "Send to Civic.Social"}
              </button>
            </form>
            {hub.plugins.enabled("feedback") && (
              <p className="feedback-fallback">
                <Link to="/admin/feedback">Back to Feedback</Link>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
