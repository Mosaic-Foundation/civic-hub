// "Your hub is ready" (2026-10-08, Adam). Shown once, to a person who has
// just created this hub on the start page and arrived signed in through the
// handoff (AuthContext → markHubJustCreated, ../utils/hubJustCreated.ts). It tells them the setup guide
// is in their email, in place of the visitor's welcome popup. The hub's
// terms prompt (ReAcceptModal) waits until it is closed (App.tsx).
//
// Same look as IntroPopup: the one Modal, with its styles.

import { useNavigate } from "react-router-dom";
import { theName } from "../../../src/shared/hubCopy";
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
        You're signed in as the admin of {theName(hub.name)}. <strong>Check your email</strong>: we've sent {email ? <strong>{email}</strong> : "you"}{" "}
        a short guide to setting it up, with your first steps and how to add others to run it with you.
      </p>
      <p className="intro-popup-text">
        It's a demo for now, filled with sample content so you can see how it works. Start in Hub settings to make it
        yours, or look around first.
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
