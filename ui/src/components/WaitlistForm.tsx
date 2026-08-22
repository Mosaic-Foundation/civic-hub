import { useState } from "react";
import { joinWaitlist } from "../services/waitlist";

interface Props {
  /** Optional heading rendered above the form. */
  heading?: string;
  /** Optional supporting copy under the heading. */
  description?: string;
  /**
   * Prefill the email field — used when the sign-in modal falls back to the
   * waitlist so the visitor doesn't have to retype the address they just
   * entered.
   */
  initialEmail?: string;
}

/**
 * Waitlist capture form. Shared by the BetaLanding splash and the sign-in
 * modal's private-beta fallback. Honeypot-gated (the hidden `website` field);
 * on success shows the standard confirmation instead of the form.
 *
 * The test-user checkbox is an opt-in signal for the operator: it lands on
 * the waitlist row as `wants_test_user` and is flagged in the signup email,
 * so volunteers can be moved onto the beta allowlist without extra back and
 * forth.
 */
export default function WaitlistForm({
  heading,
  description,
  initialEmail = "",
}: Props) {
  const [email, setEmail] = useState(initialEmail);
  const [notes, setNotes] = useState("");
  const [wantsTestUser, setWantsTestUser] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (honeypot) return;

    setSubmitting(true);
    setError(null);
    try {
      await joinWaitlist(email, { notes, wantsTestUser });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="beta-waitlist">
      {heading && <h2>{heading}</h2>}
      {description && <p>{description}</p>}

      {success ? (
        <div className="beta-waitlist-success">
          You're on the list! We'll email you when access opens up.
        </div>
      ) : (
        <form className="beta-waitlist-form" onSubmit={handleSubmit}>
          <input
            className="form-input"
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={submitting}
          />
          <textarea
            className="form-textarea"
            placeholder="Anything you'd like us to know? (optional)"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={submitting}
            maxLength={500}
          />
          <label className="beta-waitlist-checkbox">
            <input
              type="checkbox"
              checked={wantsTestUser}
              onChange={(e) => setWantsTestUser(e.target.checked)}
              disabled={submitting}
            />
            <span>
              I'd like to be a test user
              <span className="beta-waitlist-checkbox-hint">
                You'll be approved onto the beta allowlist.
              </span>
            </span>
          </label>
          <div className="beta-hp" aria-hidden="true">
            <label>
              Website
              <input
                type="text"
                name="website"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
              />
            </label>
          </div>
          <button
            type="submit"
            className="beta-waitlist-submit"
            disabled={submitting || !email}
          >
            {submitting ? "Joining..." : "Join waitlist"}
          </button>
          {error && <p className="beta-waitlist-error">{error}</p>}
        </form>
      )}
    </section>
  );
}
