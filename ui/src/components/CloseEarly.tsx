// Close early (Actions slice, 2026-10-13): an admin closes a vote, proposal
// or conversation before its deadline, and must say why. It runs the same
// close as the deadline's (closed state, closing card, brief); the page and
// the brief then carry "Closed early on …" and the admin's note, and the
// admin log records who closed it.
//
// Universal: the page's read model says whether it can close early now and
// by which action (`early_close`); nothing here names a type.

import { useId, useState } from "react";
import Modal from "./Modal";
import { useAuth } from "../context/AuthContext";
import { useAction } from "../hooks/useAction";
import { closeEarly, type EarlyCloseOffer, type ClosedEarly } from "../services/api";
import { CLOSE_EARLY_NOTE_MAX } from "../../../src/shared/closedEarly";
import "./CloseEarly.css";
import { formatDate } from "../utils/dates";

/** The admin's button and its dialog. Renders nothing for anyone else, or when it can't close early. */
export function CloseEarlyButton<V>({
  processId,
  offer,
  noun,
  onView,
}: {
  processId: string;
  offer: EarlyCloseOffer | null | undefined;
  /** What is closing, in words: "vote", "proposal", "conversation". */
  noun: string;
  /** The process as the answer has it (null: read it again). */
  onView: (view: V | null) => void;
}) {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const action = useAction(`The ${noun} couldn't be closed. Please try again.`);
  const noteId = useId();
  const helpId = useId();

  if (!isAdmin || !offer) return null;

  async function confirm() {
    const trimmed = note.trim();
    if (!trimmed) {
      action.setError("Write a note saying why it is closing early.");
      return;
    }
    const answer = await action.run(() => closeEarly<V>(processId, offer!.action, trimmed));
    if (!answer) return;
    setOpen(false);
    setNote("");
    onView(answer.view);
  }

  return (
    <>
      <button type="button" className="close-early-open-btn" onClick={() => setOpen(true)}>
        Close early
      </button>
      {open && (
        <Modal
          title={`Close this ${noun} early?`}
          onClose={() => {
            setOpen(false);
            action.setError(null);
          }}
          dismissible={!action.busy}
          describedBy={helpId}
        >
          <p id={helpId} className="close-early-help">
            It closes now instead of on {formatDate(offer.deadline)}, the same way it would at its deadline. Your note
            is shown on the page and in the brief, word for word. The admin log records that you closed it.
          </p>
          <label htmlFor={noteId} className="close-early-label">
            Why is it closing early? <span className="close-early-required">(required)</span>
          </label>
          <textarea
            id={noteId}
            className="close-early-note"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, CLOSE_EARLY_NOTE_MAX))}
            maxLength={CLOSE_EARLY_NOTE_MAX}
            rows={4}
            disabled={action.busy}
            aria-required="true"
          />
          <span className="close-early-counter">
            {note.length} / {CLOSE_EARLY_NOTE_MAX}
          </span>
          {action.error && (
            <p className="form-error" role="alert">
              {action.error}
            </p>
          )}
          <div className="confirm-actions">
            <button
              type="button"
              className="draft-submit-btn"
              onClick={confirm}
              disabled={action.busy || note.trim().length === 0}
              aria-busy={action.busy}
            >
              {action.busy && <span className="btn-spinner" aria-hidden="true" />}
              {action.busy ? "Closing…" : `Close the ${noun} now`}
            </button>
            <button
              type="button"
              className="draft-secondary-btn"
              onClick={() => setOpen(false)}
              disabled={action.busy}
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** "Closed early on …", then "Admin note:" and the note verbatim. */
export function ClosedEarlyNote({ closedEarly }: { closedEarly: Pick<ClosedEarly, "line" | "note"> | null | undefined }) {
  if (!closedEarly) return null;
  return (
    <div className="closed-early-note" role="note">
      <p className="closed-early-line">{closedEarly.line}</p>
      <p className="closed-early-admin-note">
        <span className="closed-early-admin-label">Admin note:</span> {closedEarly.note}
      </p>
    </div>
  );
}
