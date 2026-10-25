import { useState } from "react";
import { useHub } from "../config/hub";
import { useAuth } from "../context/authState";
import Modal from "./Modal";
import WaitlistForm from "./WaitlistForm";
import ModeNotice from "./ModeNotice";
import "./BetaBanner.css";

/**
 * The beta bar, shown to EVERYONE in the full app whenever hub.beta_mode is
 * true — signed-in testers and signed-out preview browsers alike. One
 * message, editable per hub (`copy.beta_banner`): this hub is in beta — and,
 * while sample content is left, that the content marked Sample is not real
 * community input. Closing it leaves a thin "Beta hub" bar (ModeNotice;
 * navigation polish, 2026-10-14), so the reminder still survives a tester
 * three pages deep in a seeded process.
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
  const hub = useHub();
  const { user, loading } = useAuth();
  const [showWaitlist, setShowWaitlist] = useState(false);

  const showCta = !loading && !user;

  return (
    <>
      {/* Closable since the navigation polish (Adam, 2026-10-14): closed, a
          thin "Beta hub" bar stays, the waitlist button still on its right. */}
      <ModeNotice
        label="Beta notice"
        short="Beta hub"
        message={
          // The hub's own sentence, or the default, which mentions sample
          // content only while some is left (review R45).
          hub.beta_banner
        }
        action={
          showCta && (
            <button type="button" className="beta-banner-cta" onClick={() => setShowWaitlist(true)}>
              Join the waitlist
            </button>
          )
        }
      />

      {showWaitlist && (
        <WaitlistDialog onDismiss={() => setShowWaitlist(false)} />
      )}
    </>
  );
}

function WaitlistDialog({ onDismiss }: { onDismiss: () => void }) {
  // WaitlistForm shows its own "Join the waitlist" heading, so the Modal's
  // title (which labels the dialog) is for screen readers only.
  return (
    <Modal
      title="Join the waitlist"
      hideTitle
      className="beta-waitlist-dialog"
      bodyClassName="beta-waitlist-dialog-body"
      onClose={onDismiss}
    >
      <WaitlistForm
        heading="Join the waitlist"
        description="Interested in participating? Leave your email and we'll let you know when the hub opens up."
      />
    </Modal>
  );
}
