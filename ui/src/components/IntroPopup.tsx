import { useNavigate } from "react-router-dom";
import { theName } from "../../../src/shared/hubCopy";
import { useHub } from "../config/hub";
import Modal from "./Modal";
import { markIntroSeen } from "./introSeen";
import "./IntroPopup.css";

interface Props {
  onDismiss: () => void;
}

/**
 * Slice 10 — first-visit welcome popup, on the one Modal (focus trap,
 * Escape, ×, backdrop click). Every way out marks the intro seen.
 *
 * Copy is intentionally short (3 sentences max) and Floyd-specific.
 * No sign-in ask — that happens when a resident tries to participate.
 */
export default function IntroPopup({ onDismiss }: Props) {
  const hub = useHub();
  const navigate = useNavigate();

  function handleDismiss() {
    markIntroSeen();
    onDismiss();
  }

  function handleLearnMore() {
    handleDismiss();
    navigate(hub.has_welcome ? "/welcome" : "/about");
  }

  return (
    <Modal
      title={<>Welcome to {theName(hub.name)}.</>}
      titleClassName="intro-popup-title"
      className="intro-popup"
      bodyClassName="intro-popup-body"
      onClose={handleDismiss}
    >
      <p className="intro-popup-text">{hub.intro_body}</p>

      <div className="intro-popup-actions">
        <button
          type="button"
          className="intro-popup-primary"
          onClick={handleDismiss}
          autoFocus
        >
          Got it
        </button>
        <button
          type="button"
          className="intro-popup-secondary"
          onClick={handleLearnMore}
        >
          Learn more
        </button>
      </div>
    </Modal>
  );
}
