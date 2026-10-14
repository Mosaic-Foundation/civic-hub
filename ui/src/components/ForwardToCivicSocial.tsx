// Admin → Feedback, one item (feedback routing, 2026-10-13): the badge an
// item shared with Civic.Social carries, with Civic.Social's status, and the
// "Send to Civic.Social" button for one that wasn't (a misfiled report).

import { useId, useState } from "react";
import Modal from "./Modal";
import { adminForwardFeedback, type FeedbackSubmission, type MosaicCopy, type MosaicStream } from "../services/api";

const STATUS_LABELS: Record<MosaicCopy["status"], string> = {
  received: "Received",
  planned: "Planned",
  fixed: "Fixed",
};

/** "Sent to Civic.Social · Planned". */
export function MosaicBadge({ copy }: { copy: MosaicCopy }) {
  const status = STATUS_LABELS[copy.status] ?? copy.status;
  const how = copy.sent_by === "admin" ? "forwarded by an admin" : "sent by the person who wrote it";
  return (
    <span
      className={`admin-feedback-mosaic mosaic-${copy.status}`}
      data-testid="mosaic-badge"
      title={`Shared with Civic.Social as ${copy.stream === "bug" ? "a bug" : "a feature request"}, ${how}. Civic.Social's status: ${status}.`}
    >
      Sent to Civic.Social · <strong>{status}</strong>
    </span>
  );
}

/** The button and its question: a bug, or an idea for the software? */
export function ForwardButton({
  item,
  onForwarded,
}: {
  item: FeedbackSubmission;
  onForwarded: (next: FeedbackSubmission) => void;
}) {
  const [open, setOpen] = useState(false);
  const [stream, setStream] = useState<MosaicStream>(item.category === "idea" ? "feature" : "bug");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const helpId = useId();

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await adminForwardFeedback(item.id, stream);
      onForwarded(res.item);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send it. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="admin-feedback-forward" onClick={() => setOpen(true)}>
        Send to Civic.Social
      </button>
      {open && (
        <Modal title="Send to Civic.Social?" onClose={() => setOpen(false)} dismissible={!busy} describedBy={helpId}>
          <p id={helpId}>
            Civic.Social maintains the software. They get the message, the page and the browser, not the sender's
            name or address. You'll see their status here. The admin log records that you sent it.
          </p>
          <fieldset className="admin-feedback-stream">
            <legend>It is</legend>
            <label>
              <input type="radio" name={`stream-${item.id}`} checked={stream === "bug"} onChange={() => setStream("bug")} />
              Something broken (a bug)
            </label>
            <label>
              <input
                type="radio"
                name={`stream-${item.id}`}
                checked={stream === "feature"}
                onChange={() => setStream("feature")}
              />
              An idea for the software
            </label>
          </fieldset>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="confirm-actions">
            <button type="button" className="draft-secondary-btn" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="draft-submit-btn" onClick={send} disabled={busy}>
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
