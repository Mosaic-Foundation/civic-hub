import { useEffect, useRef, useState } from "react";
import hub from "../config/hub";
import AuthModal from "./AuthModal";
import WaitlistForm from "./WaitlistForm";
import { enterPreview } from "../hooks/usePreviewMode";
import "./BetaWelcomeDialog.css";

/**
 * The private-beta front door, replacing the old full-page BetaLanding
 * wall: a logged-out first-time visitor now lands on the real app with
 * this dialog floating over it, so the browsable site is visible behind
 * the invitation instead of hidden by a splash page. Carries the same
 * content the wall did — beta explainer, Sign in, Browse, and the
 * shared WaitlistForm (test-user checkbox included).
 *
 * Every way out (X, backdrop, Escape, "Browse the site") calls
 * enterPreview(), which flips the session preview flag; App then stops
 * rendering this dialog and the visitor is browsing read-only, with the
 * always-on BetaBanner carrying the beta/demo reminder from there.
 * "Sign in" swaps this dialog for the shared AuthModal; dismissing that
 * brings this dialog back, completing it signs the user in (App's
 * `user` state unmounts us).
 */
export default function BetaWelcomeDialog() {
  const [showAuth, setShowAuth] = useState(false);

  if (showAuth) {
    return (
      <AuthModal
        onComplete={() => setShowAuth(false)}
        onDismiss={() => setShowAuth(false)}
      />
    );
  }

  return <WelcomeDialog onSignIn={() => setShowAuth(true)} />;
}

function WelcomeDialog({ onSignIn }: { onSignIn: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === e.currentTarget) enterPreview();
  }

  return (
    <dialog
      ref={dialogRef}
      className="beta-welcome"
      aria-label={`Welcome to the ${hub.name}`}
      onClose={enterPreview}
      onClick={handleBackdropClick}
    >
      <div className="beta-welcome-body">
        <button
          type="button"
          className="beta-welcome-close"
          onClick={enterPreview}
          aria-label="Close and browse the site"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <h1 className="beta-welcome-title">{hub.name}</h1>
        <p className="beta-welcome-tagline">{hub.tagline}</p>

        <p className="beta-welcome-note">
          This hub is currently in private beta. If you've been invited, sign
          in to get started — or take a look around first.
        </p>
        <div className="beta-welcome-actions">
          <button type="button" className="beta-welcome-signin" onClick={onSignIn}>
            Sign in
          </button>
          <button type="button" className="beta-welcome-browse" onClick={enterPreview}>
            Browse the site &rarr;
          </button>
        </div>
        <p className="beta-welcome-feedback-note">
          Have a look around and tell us what you think — use the{" "}
          <strong>Feedback</strong> button at the top of any page.
        </p>

        <WaitlistForm
          heading="Join the waitlist"
          description="Interested in participating? Leave your email and we'll let you know when the hub opens up."
        />
      </div>
    </dialog>
  );
}
