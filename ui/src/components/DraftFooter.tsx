import { useEffect, useState, type ReactNode } from "react";

/** A field the keyboard opens for (not a checkbox, button or select). */
const TYPING_FIELDS =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"]';
const PHONE = "(max-width: 768px)";
/** How far the page must scroll, with a field focused, before the bar comes back. */
const SCROLL_TO_SHOW_PX = 80;

/**
 * At phone width, whether a text field of the drafting form has focus: the
 * pinned bar steps aside then, so the keyboard leaves room for the field. It
 * comes back when focus leaves, or when the person scrolls away from it.
 */
function useTypingOnPhone(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const phone = window.matchMedia(PHONE);
    let startY = 0;
    function onFocusIn(e: FocusEvent) {
      const el = e.target as Element | null;
      if (!phone.matches || !el?.matches?.(TYPING_FIELDS) || !el.closest(".drafting-form")) return;
      startY = window.scrollY;
      setTyping(true);
    }
    function onFocusOut() {
      // Moving to the next field fires focusout then focusin; decide after both.
      setTimeout(() => {
        const el = document.activeElement;
        if (!el?.matches?.(TYPING_FIELDS) || !el.closest(".drafting-form")) setTyping(false);
      }, 0);
    }
    function onScroll() {
      if (Math.abs(window.scrollY - startY) > SCROLL_TO_SHOW_PX) setTyping(false);
    }
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("scroll", onScroll);
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
 * steps aside while a text field has focus.
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
