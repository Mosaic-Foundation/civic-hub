import { useEffect, useRef, useState } from "react";
import hub from "../config/hub";
import { useAuth } from "../context/AuthContext";
import WaitlistForm from "./WaitlistForm";
import "./BetaBanner.css";

/**
 * Always-on beta bar, shown to EVERYONE in the full app whenever
 * hub.beta_mode is true — signed-in testers and signed-out preview
 * browsers alike. One message: this hub is in beta and seeded with demo
 * content, not real community input. Deliberately not dismissible — the
 * reminder must survive a tester three pages deep in a seeded process.
 * Gone at public launch with zero code change when beta_mode flips off.
 *
 * The bar's text is identical in both auth states, so nothing visibly
 * swaps during the session-restore race on a hard reload; the waitlist
 * CTA (signed-out visitors only) is held back until auth has resolved
 * so it never flashes for signed-in users. The CTA opens the shared
 * WaitlistForm — test-user checkbox included — in a modal, so a visitor
 * browsing mid-site doesn't lose their place.
 *
 * Replaces the former PreviewBanner (signed-out preview bar) and
 * BetaDemoBanner (signed-in demo notice) pair.
 */
export default function BetaBanner() {
  const { user, loading } = useAuth();
  const [showWaitlist, setShowWaitlist] = useState(false);

  const showCta = !loading && !user;

  return (
    <>
      <div className="beta-banner" role="region" aria-label="Beta notice">
        <span className="beta-banner-text">
          You're browsing the {hub.name} beta —{" "}
          <strong>
            much of what you see is demo content, not real community topics.
          </strong>{" "}
          <span className="beta-banner-sub">
            Real topics from {hub.jurisdiction} arrive at public launch.
          </span>
        </span>
        {showCta && (
          <button
            type="button"
            className="beta-banner-cta"
            onClick={() => setShowWaitlist(true)}
          >
            Join the waitlist
          </button>
        )}
      </div>

      {showWaitlist && (
        <WaitlistDialog onDismiss={() => setShowWaitlist(false)} />
      )}
    </>
  );
}

function WaitlistDialog({ onDismiss }: { onDismiss: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === e.currentTarget) onDismiss();
  }

  return (
    <dialog
      ref={dialogRef}
      className="beta-waitlist-dialog"
      aria-label="Join the waitlist"
      onClose={onDismiss}
      onClick={handleBackdropClick}
    >
      <div className="beta-waitlist-dialog-body">
        <button
          type="button"
          className="beta-waitlist-dialog-close"
          onClick={onDismiss}
          aria-label="Close"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <WaitlistForm
          heading="Join the waitlist"
          description="Interested in participating? Leave your email and we'll let you know when the hub opens up."
        />
      </div>
    </dialog>
  );
}
