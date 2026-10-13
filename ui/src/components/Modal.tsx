import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import "./Modal.css";

/**
 * The one modal (Submit and Save, 2026-10-12). Every dialog in the hub, the
 * console and the start page is this component, so they behave alike:
 *
 *   - a native <dialog> opened with showModal(): the page behind is inert,
 *     so focus stays inside (the focus trap), and it sits above everything;
 *   - labeled by its title (aria-labelledby), which is always present; pass
 *     `hideTitle` to keep it for screen readers only;
 *   - Escape, the × button and a click on the backdrop close it, unless
 *     `dismissible` is false (while something is being saved);
 *   - focus goes to `initialFocus` (or the first field or button) on open,
 *     and back to what had it before on close.
 *
 * It is open while it is rendered: a parent shows it with `{open && <Modal>}`.
 */
export default function Modal({
  title,
  hideTitle = false,
  onClose,
  children,
  dismissible = true,
  closeOnBackdrop = true,
  showClose = true,
  closeLabel = "Close",
  initialFocus,
  className,
  bodyClassName,
  titleClassName,
  describedBy,
  role,
}: {
  title: ReactNode;
  hideTitle?: boolean;
  onClose: () => void;
  children: ReactNode;
  /** False while saving: Escape, × and the backdrop do nothing. */
  dismissible?: boolean;
  closeOnBackdrop?: boolean;
  showClose?: boolean;
  closeLabel?: string;
  initialFocus?: RefObject<HTMLElement | null>;
  /** On the <dialog>: its width and placement (a component's own class). */
  className?: string;
  /** On the panel inside: its padding and background. */
  bodyClassName?: string;
  titleClassName?: string;
  describedBy?: string;
  /** "alertdialog" for a dialog that needs an answer before going on. */
  role?: "dialog" | "alertdialog";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // The latest values, read by listeners attached once.
  const latest = useRef({ onClose, dismissible });
  useEffect(() => {
    latest.current = { onClose, dismissible };
  }, [onClose, dismissible]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const before = document.activeElement as HTMLElement | null;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // Not connected yet, or a browser without showModal: still visible.
        dialog.setAttribute("open", "");
      }
    }
    // In this order, not document order (× comes first in the markup): the
    // field to type in, else the first action, else ×.
    const target =
      initialFocus?.current ??
      [
        "[autofocus]",
        "input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])",
        "button:not(.modal-close):not([disabled]), a[href]",
        ".modal-close",
      ]
        .map((sel) => dialog.querySelector<HTMLElement>(sel))
        .find((el) => el !== null);
    target?.focus();
    document.documentElement.classList.add("modal-open");

    // Escape fires "cancel": the dialog would close itself, behind React's
    // back. It is the parent's to close, so the dialog only asks.
    function onCancel(e: Event) {
      e.preventDefault();
      if (latest.current.dismissible) latest.current.onClose();
    }
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      if (!document.querySelector("dialog.modal[open]")) document.documentElement.classList.remove("modal-open");
      before?.focus?.();
    };
    // Opened once; initialFocus is read on open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal${className ? ` ${className}` : ""}`}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      aria-modal="true"
      role={role === "alertdialog" ? "alertdialog" : undefined}
      // A click on the dialog itself, not its panel, is a click on the backdrop.
      onClick={(e) => {
        if (e.target === e.currentTarget && closeOnBackdrop && dismissible) onClose();
      }}
    >
      <div className={`modal-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>
        {showClose && (
          <button
            type="button"
            className="modal-close"
            aria-label={closeLabel}
            onClick={onClose}
            disabled={!dismissible}
          >
            &times;
          </button>
        )}
        <h2 id={titleId} className={hideTitle ? "visually-hidden" : `modal-title${titleClassName ? ` ${titleClassName}` : ""}`}>
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
