import { useState } from "react";
import { Link } from "react-router-dom";
import { pluginEnabled } from "../config/plugins";
import hub from "../config/hub";
import "./WelcomeBanner.css";

const STORAGE_KEY = "welcome-banner-dismissed-v2";

function isDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function dismiss(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // localStorage unavailable — banner may reappear, acceptable
  }
}

export default function WelcomeBanner() {
  const [visible, setVisible] = useState(() => !isDismissed());

  // The hub's own paragraph, or the default by kind and type of place
  // (src/shared/hubCopy.ts, review R17); hidden in Settings → Copy.
  if (!visible || hub.welcome_strip_hidden) return null;
  const custom = hub.welcome_strip !== hub.welcome_strip_default;

  function handleDismiss() {
    dismiss();
    setVisible(false);
  }

  return (
    <section className="welcome-banner">
      <div className="welcome-banner-inner">
        <div className="welcome-banner-content">
          <h2 className="welcome-banner-title">{hub.welcome_strip_title}</h2>
          <p className="welcome-banner-body">
            {hub.welcome_strip}
            {/* The default goes on to the feedback pointer; a hub's own
                paragraph is shown as written. The button is the Feedback
                plugin's; without it, no pointer. */}
            {!custom && (
              <>
                {" "}It's early and still evolving
                {pluginEnabled("feedback") ? (
                  <>
                    {" "}— use the feedback button at the top anytime to report a
                    bug, suggest a feature, or share anything else.
                  </>
                ) : (
                  "."
                )}{" "}
                We're building this with you.
              </>
            )}
          </p>
          <div className="welcome-banner-actions">
            {/* The Welcome page when the hub has written one, else About
                (review R27: never a page that says it has nothing). */}
            <Link to={hub.has_welcome ? "/welcome" : "/about"} className="welcome-banner-button">
              Learn more
            </Link>
            <button
              type="button"
              className="welcome-banner-dismiss"
              onClick={handleDismiss}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
