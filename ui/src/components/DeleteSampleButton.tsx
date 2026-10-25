import { useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { useAction } from "../hooks/useAction";
import { adminDeleteSample, type SampleContentSummary } from "../services/api";
import { refreshHubConfig } from "../config/hubConfig";
import { forgetSampleIds } from "./deletableSample";

/**
 * Delete one sample (admin menu slice, 2026-10-13): a button and its
 * confirmation. No emailed code (Adam, 2026-10-13); the delete is recorded in
 * Settings → Admin log. Used in Settings → Sample content's list and beside
 * Archive on a sample's own page.
 */

export default function DeleteSampleButton({
  processId,
  what,
  className = "admin-remove-section",
  label,
  onDeleted,
}: {
  processId: string;
  /** What goes, as the sentence starts: "“Title”" or "This vote". */
  what: string;
  className?: string;
  /** The button's name for screen readers, where several sit in a list. */
  label?: string;
  onDeleted: (summary: SampleContentSummary) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const action = useAction("Could not delete the sample");

  async function remove() {
    const result = await action.run(() => adminDeleteSample(processId));
    if (!result) return;
    forgetSampleIds();
    setConfirming(false);
    // The demo bar's "Remove samples" goes with the last one.
    void refreshHubConfig();
    onDeleted(result.summary);
  }

  return (
    <>
      <button type="button" className={className} aria-label={label} onClick={() => setConfirming(true)}>
        Delete sample
      </button>
      {confirming && (
        <ConfirmDialog
          title="Delete this sample?"
          confirmLabel="Delete sample"
          busyLabel="Deleting…"
          busy={action.busy}
          cancelLabel="Keep it"
          onConfirm={() => void remove()}
          onClose={() => {
            action.setError(null);
            setConfirming(false);
          }}
        >
          <p>
            {what} goes for good, with anything people added to it. This can’t be undone.
          </p>
          {action.error && (
            <p className="form-error" role="alert">
              {action.error}
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
