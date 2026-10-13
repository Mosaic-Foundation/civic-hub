import type { ReactNode } from "react";

/**
 * The floating bar at the bottom of every drafting form (Submit and Save,
 * 2026-10-12): one slim row, a short status on the left, any secondary
 * action as a quiet outlined button, and Submit as the one primary button.
 * Submit runs the Code of Conduct check, so there is no separate check
 * button; while it runs the button says so and can't be pressed again.
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
  const status = missing
    ? { text: missing, tone: "missing" }
    : flagged > 0
      ? { text: "Change what the check flagged, then press Submit again.", tone: "blocked" }
      : { text: "Submitting runs a quick Code of Conduct check.", tone: "hint" };
  return (
    <div className="drafting-form-footer">
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
