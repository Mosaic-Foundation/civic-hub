// The Feedback plugin's UI module (ui/src/features.ts): the Feedback form for
// everyone, linked from the top bar, the sidebar, the menu drawer and the
// footer; Admin → Feedback with its count of what is new; the pointers in the
// welcome strip and the beta welcome; and its panel on the Plugins page.

import { lazy } from "react";
import { Link } from "react-router-dom";
import type { FeatureUi } from "../../ui/src/features";
import { EmailField } from "../../ui/src/pages/settings/fields";
import { feedbackContactEmail } from "../../src/shared/platform";

const Feedback = lazy(() => import("./ui/Feedback"));
const AdminFeedback = lazy(() => import("./ui/AdminFeedback"));

/** The top bar's megaphone. */
function FeedbackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2 8.5L2 15.5L7 15.5L14 20L14 4L7 8.5Z" fill="currentColor" />
      <ellipse cx="14" cy="12" rx="1.2" ry="4.5" fill="currentColor" opacity="0.3" />
      <path d="M17 8.5C18.3 9.5 19 10.7 19 12C19 13.3 18.3 14.5 17 15.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <path d="M19.5 6.5C21.5 8 22.5 9.9 22.5 12C22.5 14.1 21.5 16 19.5 17.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}

const feedbackUi: FeatureUi = {
  feature: "feedback",
  routes: [
    // Open to anonymous and signed-in people alike.
    { path: "/feedback", element: <Feedback /> },
    // Read-only archive of what residents sent, incl. topic suggestions.
    { path: "/admin/feedback", element: <AdminFeedback />, admin: true },
  ],
  adminTab: { label: "Feedback", path: "/admin/feedback", icon: "feedback", group: "community", queue: "feedback" },
  spaceLink: {
    path: "/feedback",
    label: "Feedback",
    icon: "feedback",
    longLabel: "Send feedback",
    header: { label: "Feedback", ariaLabel: "Give feedback", Icon: FeedbackIcon },
    publicInBeta: true,
    formPage: true,
    welcomeNote: "use Feedback anytime to report a bug, suggest a feature, or share anything else.",
    betaNote: (
      <>
        Have a look around and tell us what you think — use the <strong>Feedback</strong> button at the top of any
        page.
      </>
    ),
  },
  settingsPanel: (f) => (
    <EmailField
      f={f}
      k="plugin.feedback.contact_email"
      label="Address on the Feedback page"
      placeholder={feedbackContactEmail(undefined, f.data.values["legal.contact_email"])}
      hint={
        <>
          Where the{" "}
          <a href="/feedback" target="_blank" rel="noreferrer">
            Feedback page
          </a>{" "}
          tells people to write if they would rather email. Left empty, it shows the contact address under{" "}
          <Link to="/admin/settings/legal">Legal</Link>, or the platform's when that is empty too: the address shown
          here.
        </>
      }
    />
  ),
};

export default feedbackUi;
