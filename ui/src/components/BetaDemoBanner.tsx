import { useState } from "react";
import hub from "../config/hub";
import "./BetaDemoBanner.css";

// Per-session, not per-device: sessionStorage means a tester who dismisses
// the bar isn't nagged on every page nav, but the reminder returns next
// session — demo data stays flagged for the whole beta. Distinct from
// WelcomeBanner's localStorage key on purpose.
const STORAGE_KEY = "beta-demo-banner-dismissed";

function isDismissed(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function dismiss(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // sessionStorage unavailable — banner may reappear, acceptable
  }
}

/**
 * Thin site-wide bar shown to signed-in testers while the private beta is
 * running: the hub is seeded with demo processes, and this keeps testers
 * from mistaking them for real community input. Gated purely on
 * hub.beta_mode, so it disappears at public launch with no code change.
 * Mutually exclusive with PreviewBanner (App.tsx suppresses this one while
 * the read-only preview bar is showing) so no audience ever sees two bars.
 */
export default function BetaDemoBanner() {
  const [visible, setVisible] = useState(() => !isDismissed());

  if (!visible) return null;

  function handleDismiss() {
    dismiss();
    setVisible(false);
  }

  return (
    <div className="beta-demo-banner" role="region" aria-label="Demo content notice">
      <span className="beta-demo-banner-text">
        Beta: much of what you see is demo content, not real
        community-proposed topics.{" "}
        <span className="beta-demo-banner-sub">
          Real topics from {hub.jurisdiction} arrive at public launch.
        </span>
      </span>
      <button
        type="button"
        className="beta-demo-banner-dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss demo content notice"
      >
        Dismiss
      </button>
    </div>
  );
}
