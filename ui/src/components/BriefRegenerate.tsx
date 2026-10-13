// Regenerate a brief (Actions slice, 2026-10-13), on the admin's brief page.
//
// - Not yet published: "Regenerate summary" makes it again from the closed
//   process and replaces this draft; the text it replaces is kept.
// - Published: it makes a new version and stages it here. The admin reads
//   it, then publishes it (the brief's page and its feed card show it,
//   marked "Updated <date>"; nobody is emailed again) or discards it.
// - Every version replaced is listed under "Earlier versions".
// The admin log records who regenerated and who published.

import { useState } from "react";
import { useAction } from "../hooks/useAction";
import {
  adminDiscardBriefRevision,
  adminPublishBriefRevision,
  adminRegenerateBrief,
  type BriefContent,
  type BriefDetail,
} from "../services/api";
import ConfirmDialog from "./ConfirmDialog";
import "./BriefRegenerate.css";

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Version({ content }: { content: BriefContent }) {
  return (
    <div className="brief-version">
      <p className="brief-version-headline">{content.headline}</p>
      <p className="brief-version-summary">{content.summary}</p>
      {content.sections.map((s, i) => (
        <div key={i}>
          <h4>{s.heading}</h4>
          <p className="brief-version-section">{s.body}</p>
        </div>
      ))}
    </div>
  );
}

export default function BriefRegenerate({
  brief,
  onBrief,
}: {
  brief: BriefDetail;
  /** The brief as the answer has it. */
  onBrief: (brief: BriefDetail, message: string) => void;
}) {
  const action = useAction("That didn't go through. Please try again.");
  const [confirming, setConfirming] = useState(false);
  const published = brief.publication_status === "published";
  const revision = brief.pending_revision ?? null;
  const history = brief.history ?? [];

  async function regenerate() {
    const answer = await action.run(() => adminRegenerateBrief(brief.id));
    setConfirming(false);
    if (!answer) return;
    onBrief(
      answer.brief,
      answer.staged
        ? "A new version is ready below. The published brief is unchanged until you publish it."
        : "Made again. The text it replaced is kept under Earlier versions.",
    );
  }

  async function publishRevision() {
    const answer = await action.run(() => adminPublishBriefRevision(brief.id));
    if (answer) onBrief(answer.brief, "Published. The brief's page and its feed card show the new version. Nobody was emailed.");
  }

  async function discardRevision() {
    const answer = await action.run(() => adminDiscardBriefRevision(brief.id));
    if (answer) onBrief(answer.brief, "The new version was discarded. The published brief is unchanged.");
  }

  return (
    <section className="admin-detail-section brief-regenerate">
      <h3>Regenerate summary</h3>
      <p className="form-hint">
        {published
          ? "Make a new version from the closed process, for example after closing it early or when the summary was poor. You read it here first; the published brief stays as it is until you publish the new one. Nobody is emailed again."
          : "Make this brief again from the closed process. It replaces the text above; the current text is kept under Earlier versions."}
      </p>
      {!revision && (
        <button
          type="button"
          className="draft-secondary-btn"
          onClick={() => (published ? regenerate() : setConfirming(true))}
          disabled={action.busy}
          aria-busy={action.busy}
        >
          {action.busy ? "Regenerating…" : "Regenerate summary"}
        </button>
      )}
      {action.error && (
        <p className="form-error" role="alert">
          {action.error}
        </p>
      )}

      {revision && (
        <div className="brief-revision" aria-label="New version">
          <h4>New version, made {when(revision.generated_at)}</h4>
          <Version content={revision.content} />
          <div className="confirm-actions">
            <button type="button" className="draft-submit-btn" onClick={publishRevision} disabled={action.busy} aria-busy={action.busy}>
              {action.busy ? "Working…" : "Publish this version"}
            </button>
            <button type="button" className="draft-secondary-btn" onClick={discardRevision} disabled={action.busy}>
              Discard it
            </button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <details className="brief-history">
          <summary>
            {history.length} earlier version{history.length === 1 ? "" : "s"}
          </summary>
          {[...history].reverse().map((h, i) => (
            <div key={i} className="brief-history-item">
              <p className="form-hint">
                Made {when(h.generated_at)}, replaced {when(h.replaced_at)}
              </p>
              <Version content={h.content} />
            </div>
          ))}
        </details>
      )}

      {confirming && (
        <ConfirmDialog
          title="Regenerate this brief?"
          confirmLabel="Regenerate"
          busyLabel="Regenerating…"
          busy={action.busy}
          cancelLabel="Cancel"
          onConfirm={regenerate}
          onClose={() => setConfirming(false)}
        >
          <p>Any edits you haven't saved here will be lost. The current text is kept under Earlier versions.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
