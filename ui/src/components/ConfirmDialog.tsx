import type { ReactNode } from "react";
import Modal from "./Modal";

/**
 * A confirmation: a heading, what is being confirmed, and two buttons, on
 * the one Modal. One component for what the four drafting pages each had a
 * copy of (the submit confirmation, Audit 3). While `busy`, it can't be
 * closed and the confirm button says what is happening (`busyLabel`).
 */
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel = "Submitting…",
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
    <Modal title={title} onClose={onClose} dismissible={!busy}>
      {children}
      <div className="confirm-actions">
        <button
          type="button"
          className="draft-submit-btn"
          onClick={onConfirm}
          disabled={busy}
          aria-busy={busy}
        >
          {busy && <span className="btn-spinner" aria-hidden="true" />}
          {busy ? busyLabel : confirmLabel}
        </button>
        <button type="button" className="draft-secondary-btn" onClick={onClose} disabled={busy}>
          {cancelLabel}
        </button>
      </div>
    </Modal>
  );
}
