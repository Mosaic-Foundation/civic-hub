// Sample content — the illustrative processes a new hub may start with
// (Phase 7), and the one control that removes them all.
//
// Available in every mode, not only demo: a hub that graduated and kept its
// samples can still take them out. Removal takes a fresh emailed code, like a
// mode or roster change (src/controllers/adminStepUp.ts), because it cannot
// be undone and may take real people's input with it; it is recorded in the
// hub's own admin log.
//
// One sample at a time (admin menu slice, 2026-10-13): each is listed with a
// Delete button, no code, recorded in the admin log too. When the last seeded
// sample goes, "Next: set up your hub" takes the list's place. Since the
// leaving-demo slice (2026-10-15) it also heads the section while the hub is a
// demo, samples or not, and a new admin's first sign-in lands on it.

import HelpButton from "../../components/HelpButton";
import { useState } from "react";
import { useApi } from "../../hooks/useApi";
import { Link } from "react-router-dom";
import DeleteSampleButton from "../../components/DeleteSampleButton";
import { friendlyType } from "../../components/ProcessLinkPicker";
import { getLoadedHubConfig } from "../../config/hubConfig";
import { NextSteps } from "./nextSteps";
import {
  adminGetSampleContent,
  adminRemoveSampleContent,
  adminRequestSampleRemovalCode,
  type SampleContentSummary,
} from "../../services/api";
import { SampleRemovalWarning } from "./sampleWarning";

export default function SampleContentSection() {
  const {
    data: read,
    error: readError,
    setData: setSummary,
  } = useApi<SampleContentSummary>("admin/sample-content", () => adminGetSampleContent());
  const summary = read ?? null;
  const loadError = readError?.message ?? null;
  const [confirming, setConfirming] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function requestCode() {
    setMessage(null);
    try {
      const { message: sent } = await adminRequestSampleRemovalCode();
      setCodeSent(true);
      setMessage({ text: sent, error: false });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Could not send a code", error: true });
    }
  }

  async function remove() {
    setBusy(true);
    setMessage(null);
    try {
      const { summary: after } = await adminRemoveSampleContent(code.trim());
      setSummary(after);
      setConfirming(false);
      setCodeSent(false);
      setCode("");
      setMessage({ text: "Removed. The sample content is gone.", error: false });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Could not remove the sample content", error: true });
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setConfirming(false);
    setCodeSent(false);
    setCode("");
    setMessage(null);
  }

  if (loadError) return <p className="form-error">{loadError}</p>;

  const demo = getLoadedHubConfig()?.hub.mode === "demo";

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">
        Sample content
        <HelpButton k="settings.sample" label="Sample content" />
      </h2>
      {demo && <NextSteps />}
      {!summary ? (
        <p className="form-hint">Loading…</p>
      ) : summary.processes + (summary.added_in_demo ?? 0) === 0 ? (
        <>
          <p className="form-hint">This hub has no sample content.</p>
          {message && !message.error && (
            <p className="admin-settings-message" role="status">
              {message.text}
            </p>
          )}
          {!demo && <NextSteps />}
        </>
      ) : (
        <>
          <p className="form-hint">
            This hub has {summary.processes} sample {summary.processes === 1 ? "process" : "processes"}: illustrative
            votes, proposals and announcements, each marked <strong>Sample</strong>, so the hub did not open empty.
            They are not public record: they never appear in the hub's public event feed, its export or participants'
            email digests.
            {(summary.added_in_demo ?? 0) > 0 && (
              <>
                {" "}Visitors added {summary.added_in_demo} {summary.added_in_demo === 1 ? "item" : "items"} of their own
                while the hub was a demo; those are removed with the samples.
              </>
            )}
          </p>

          <ul className="sample-items" aria-label="Samples">
            {summary.items.map((item) => (
              <li key={item.id} className="sample-item">
                <span className="sample-item-what">
                  <Link to={item.path}>{item.title}</Link>
                  <span className="sample-item-type">
                    {friendlyType(item.type)}
                    {item.added_in_demo && " · added by a visitor"}
                  </span>
                </span>
                <DeleteSampleButton
                  processId={item.id}
                  what={`“${item.title}”`}
                  label={`Delete sample: ${item.title}`}
                  onDeleted={(after) => {
                    setSummary(after);
                    setMessage({ text: `Deleted “${item.title}”.`, error: false });
                  }}
                />
              </li>
            ))}
          </ul>
          {summary.processes === 0 && !demo && <NextSteps />}

          {confirming && <SampleRemovalWarning summary={summary} />}

          <div className="settings-form-footer">
            <div className="admin-settings-actions">
              {!confirming && (
                <button type="button" className="admin-remove-section" onClick={() => setConfirming(true)}>
                  Remove sample content…
                </button>
              )}
              {confirming && !codeSent && (
                <button type="button" className="admin-convert-button" onClick={requestCode} disabled={busy}>
                  Email me a code
                </button>
              )}
              {codeSent && (
                <>
                  <input
                    className="form-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="6-digit code"
                    aria-label="Confirmation code"
                    disabled={busy}
                    style={{ maxWidth: "160px" }}
                  />
                  <button
                    type="button"
                    className="admin-convert-button"
                    onClick={remove}
                    disabled={busy || code.trim().length === 0}
                  >
                    {busy ? "Removing…" : "Remove all sample content"}
                  </button>
                </>
              )}
              {confirming && (
                <button type="button" className="admin-remove-section" onClick={cancel} disabled={busy}>
                  Cancel
                </button>
              )}
              {message && (
                <span
                  className={message.error ? "form-error" : "admin-settings-message"}
                  role={message.error ? "alert" : "status"}
                >
                  {message.text}
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
