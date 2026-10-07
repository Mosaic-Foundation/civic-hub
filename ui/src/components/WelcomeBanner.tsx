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

  if (!visible) return null;

  function handleDismiss() {
    dismiss();
    setVisible(false);
  }

  return (
    <section className="welcome-banner">
      <div className="welcome-banner-inner">
        <div className="welcome-banner-content">
          <h2 className="welcome-banner-title">
            Welcome — the {hub.name} is a community pilot program
          </h2>
          <p className="welcome-banner-body">
            A new space to follow county government, raise the issues that
            matter, and decide together. It's early and still evolving
            {/* The button is the Feedback plugin's; without it, no pointer. */}
            {pluginEnabled("feedback") ? (
              <>
                {" "}— use the feedback button at the top anytime to report a
                bug, suggest a feature, or share anything else.
              </>
            ) : (
              "."
            )}{" "}
            We're building this with you.
          </p>
          <div className="welcome-banner-actions">
            <Link to="/welcome" className="welcome-banner-button">
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
