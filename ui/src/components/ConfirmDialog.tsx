import type { ReactNode } from "react";

/**
 * A confirmation modal: a heading, what is being confirmed, and two buttons.
 * One component for what the four drafting pages each had a copy of (the
 * submit confirmation, Audit 3); the classes are theirs (ProposeDraft.css,
 * the intro modal's layout), so it looks as it did.
 */
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel = "Submitting...",
  busy = false,
  cancelLabel = "Go back to draft",
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="intro-overlay" onClick={onClose}>
      <div className="intro-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button className="intro-close" onClick={onClose}>
          &times;
        </button>
        <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "var(--font-size-xl)", marginBottom: "var(--space-md)" }}>
          {title}
        </h2>
        {children}
        <div className="confirm-actions">
          <button type="button" className="draft-submit-btn" onClick={onConfirm} disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
          <button type="button" className="draft-dispute-btn" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
