import { useEffect, useState, type ReactNode } from "react";
import { editingInView, SETTLE_MS } from "../utils/editingInView";

const PHONE = "(max-width: 768px)";

/**
 * At phone width, whether the drafting form's focused text field is on
 * screen: the pinned bar steps aside then, so the keyboard leaves room for
 * the field. Scroll the field away (cursor still in it) or leave it, and the
 * bar is back, once the page is still.
 */
function useTypingOnPhone(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const phone = window.matchMedia(PHONE);
    let settle: ReturnType<typeof setTimeout> | undefined;
    const decide = () => setTyping(phone.matches && editingInView() !== null);
    const later = () => {
      clearTimeout(settle);
      settle = setTimeout(decide, SETTLE_MS);
    };
    // Focus moving between fields fires focusout then focusin; decide after both.
    const soon = () => setTimeout(decide, 0);
    document.addEventListener("focusin", soon);
    document.addEventListener("focusout", soon);
    window.addEventListener("scroll", later, { passive: true });
    window.visualViewport?.addEventListener("scroll", later);
    window.visualViewport?.addEventListener("resize", later);
    return () => {
      clearTimeout(settle);
      document.removeEventListener("focusin", soon);
      document.removeEventListener("focusout", soon);
      window.removeEventListener("scroll", later);
      window.visualViewport?.removeEventListener("scroll", later);
      window.visualViewport?.removeEventListener("resize", later);
    };
  }, []);
  return typing;
}

/**
 * The floating bar at the bottom of every drafting form (Submit and Save,
 * 2026-10-12): one slim row, a short status on the left, any secondary
 * action as a quiet outlined button, and Submit as the one primary button.
 * Submit runs the Code of Conduct check, so there is no separate check
 * button; while it runs the button says so and can't be pressed again.
 *
 * At phone width it is one row (Get suggestions as a link, Submit), the
 * "Submitting runs a quick check" hint is left to the preview box, and it
 * steps aside while the field being typed in is on screen.
 */
export default function DraftFooter({
  missing,
  flagged,
  onSubmit,
  submitLabel,
  disabled = false,
  busy = false,
  secondary,
}: {
  /** Why it can't be submitted yet (a required field), or null. */
  missing: string | null;
  /** How many things the check flagged on the text as it was submitted. */
  flagged: number;
  onSubmit: () => void;
  submitLabel: string;
  disabled?: boolean;
  /** Checking and submitting. */
  busy?: boolean;
  /** Secondary actions (Get suggestions, Cancel), drawn as such. */
  secondary?: ReactNode;
}) {
  const typing = useTypingOnPhone();
  const status = missing
    ? { text: missing, tone: "missing" }
    : flagged > 0
      ? { text: "Change what the check flagged, then press Submit again.", tone: "blocked" }
      : { text: "Submitting runs a quick Code of Conduct check.", tone: "hint" };
  return (
    <div
      className={`drafting-form-footer${status.tone !== "hint" ? " has-status" : ""}${typing ? " is-typing" : ""}`}
    >
      <p className={`draft-status draft-status--${status.tone}`} role="status">
        {status.text}
      </p>
      <div className="draft-actions">
        {secondary}
        <button
          type="button"
          className="draft-submit-btn"
          onClick={onSubmit}
          disabled={Boolean(missing) || disabled || busy}
          aria-busy={busy}
        >
          {busy && <span className="btn-spinner" aria-hidden="true" />}
          {busy ? "Checking…" : submitLabel}
        </button>
      </div>
    </div>
  );
}
