import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import hub from "../config/hub";
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
 * Slice 10 — first-visit welcome popup. Native <dialog> element gives
 * us focus trapping, escape-key handling, and backdrop click for free.
 *
 * Copy is intentionally short (3 sentences max) and Floyd-specific.
 * No sign-in ask — that happens when a resident tries to participate.
 */
export default function IntroPopup({ onDismiss }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();

  // Open the dialog imperatively on mount via showModal() so we get
  // the native modal behavior (focus trap, backdrop, ESC handling).
  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  function handleDismiss() {
    markIntroSeen();
    onDismiss();
  }

  function handleLearnMore() {
    handleDismiss();
    navigate("/welcome");
  }

  // Backdrop click dismisses. Native <dialog> reports the click target
  // as the dialog itself when the user clicks the backdrop area.
  function handleClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === e.currentTarget) handleDismiss();
  }

  return (
    <dialog
      ref={dialogRef}
      className="intro-popup"
      aria-labelledby="intro-popup-title"
      onClick={handleClick}
      onClose={handleDismiss}
    >
      <div className="intro-popup-body">
        <h2 id="intro-popup-title" className="intro-popup-title">
          Welcome to the {hub.name}.
        </h2>

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
      </div>
    </dialog>
  );
}
