// "Next: set up your hub" — the stages of the setup guide, each a link to
// where it is done (admin menu slice, 2026-10-13).
//
// Leaving-demo slice (2026-10-15): it shows while the hub is a demo whatever
// the samples (the guide says to keep them through stage 1, so a box that
// waited for them to go was never seen), it lists every step the readiness
// check asks about, and a new admin's first sign-in lands on it
// (NEXT_STEPS_PATH, components/AuthModal.tsx) instead of the residents'
// onboarding word cloud.

import { Link } from "react-router-dom";
import { PLATFORM_SETUP_GUIDE_URL } from "../../../../src/shared/platform";

/** Where a new admin lands after their first sign-in. */
export const NEXT_STEPS_PATH = "/admin/settings/sample#next-steps";

export function NextSteps() {
  return (
    <div id="next-steps" className="next-steps" role="region" aria-label="Next: set up your hub">
      <h3 className="next-steps-title">Next: set up your hub</h3>
      <ol className="next-steps-list">
        <li>
          <Link to="/admin/settings/identity">Name it, add a banner and set its time zone</Link>
          <span className="form-hint"> in Identity, then pick its colours in Theme.</span>
        </li>
        <li>
          <Link to="/admin/settings/copy">Write your Welcome and About pages</Link>
          <span className="form-hint"> in Copy &amp; pages.</span>
        </li>
        <li>
          <Link to="/admin/settings/legal">Give your contact address, and have the Terms and Privacy Policy reviewed</Link>
          <span className="form-hint"> in Legal.</span>
        </li>
        <li>
          <Link to="/admin/settings/email">Give a postal address for the hub's email</Link>
          <span className="form-hint"> in Email.</span>
        </li>
        <li>
          <Link to="/admin/settings/people">Add a second admin</Link>
          <span className="form-hint">
            {" "}in Admins &amp; board, and list your officials in{" "}
            <Link to="/admin/settings/officials">Officials</Link>.
          </span>
        </li>
        <li>
          <Link to="/admin/settings/plugins">Choose the tools your hub offers</Link>
          <span className="form-hint"> in Plugins.</span>
        </li>
        <li>
          <Link to="/admin/settings/mode">Switch to beta</Link>
          <span className="form-hint">
            {" "}in Mode, which lists anything still missing first. Put your first people on its allowlist.
          </span>
        </li>
      </ol>
      <p className="form-hint">
        Every step is in the guide:{" "}
        <a href={PLATFORM_SETUP_GUIDE_URL} target="_blank" rel="noopener">
          Set up your hub
        </a>
        .
      </p>
    </div>
  );
}
