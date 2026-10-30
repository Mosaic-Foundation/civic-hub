// "Your hub is ready" (2026-10-08, Adam). Shown once, to a person who has
// just created this hub on the start page and arrived signed in through the
// handoff (AuthContext → markHubJustCreated, ../utils/hubJustCreated.ts). It
// carries what the admin invite carries (src/services/adminInvite.ts): the
// first steps and the setup guide, in place of the visitor's welcome popup.
// The email's first step, signing in, is already done here. The hub's terms
// prompt (ReAcceptModal) waits until it is closed (App.tsx).
//
// Same look as IntroPopup: the one Modal, with its styles.

import { useNavigate } from "react-router-dom";
import { theName } from "../../../src/shared/hubCopy";
import { PLATFORM_SETUP_GUIDE_URL } from "../../../src/shared/platform";
import { useHub } from "../config/hub";
import { clearHubJustCreated } from "../utils/hubJustCreated";
import Modal from "./Modal";
import "./IntroPopup.css";

export default function HubReadyDialog({ email, onDismiss }: { email: string; onDismiss: () => void }) {
  const hub = useHub();
  const navigate = useNavigate();

  function close(next?: string) {
    clearHubJustCreated();
    onDismiss();
    if (next) navigate(next);
  }

  return (
    <Modal
      title="Your hub is ready."
      titleClassName="intro-popup-title"
      className="intro-popup"
      bodyClassName="intro-popup-body"
      onClose={() => close()}
    >
      <p className="intro-popup-text">
        You're signed in as the admin of {theName(hub.name)}. It's a demo for now, filled with sample content so you can
        see how it works.
      </p>
      <p className="intro-popup-text">Your first steps:</p>
      <ol className="intro-popup-text intro-popup-steps">
        <li>Open Hub settings. Work through Identity, Copy &amp; pages, Legal and Email, so the hub speaks for your community.</li>
        <li>Under Admins &amp; board, add anyone who will run the hub with you. They get an email with these steps.</li>
        <li>When it's ready, Hub settings → Mode moves it to beta.</li>
      </ol>
      <p className="intro-popup-text">
        <a href={PLATFORM_SETUP_GUIDE_URL} target="_blank" rel="noopener">
          Learn how to set up your hub
        </a>
        . We've also sent these steps to {email ? <strong>{email}</strong> : "your email"}.
      </p>
      <div className="intro-popup-actions">
        <button type="button" className="intro-popup-primary" onClick={() => close("/admin/settings")} autoFocus>
          Open Hub settings
        </button>
        <button type="button" className="intro-popup-secondary" onClick={() => close()}>
          Look around first
        </button>
      </div>
    </Modal>
  );
}
