import { useNavigate } from "react-router-dom";
import { theName } from "../../../src/shared/hubCopy";
import hub from "../config/hub";
import Modal from "./Modal";
import "./IntroPopup.css";

const STORAGE_KEY = "seen_intro_popup";

interface Props {
  onDismiss: () => void;
}

export function hasSeenIntro(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function markIntroSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // localStorage unavailable — popup may reappear, acceptable degradation
  }
}

/**
 * Slice 10 — clear the "seen" flag so the popup reappears on the next
 * visit. Used by the About page's "Show me the welcome again" link.
 * Doesn't force-reopen the popup right then; that would be jarring
 * after an explicit click.
 */
export function clearIntroSeen(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // No-op — same fallback as markIntroSeen.
  }
}

/**
 * Slice 10 — first-visit welcome popup, on the one Modal (focus trap,
 * Escape, ×, backdrop click). Every way out marks the intro seen.
 *
 * Copy is intentionally short (3 sentences max) and Floyd-specific.
 * No sign-in ask — that happens when a resident tries to participate.
 */
export default function IntroPopup({ onDismiss }: Props) {
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
