// Sample content — the illustrative processes a new hub may start with
// (Phase 7), and the one control that removes them all.
//
// Available in every mode, not only demo: a hub that graduated and kept its
// samples can still take them out. Removal takes a fresh emailed code, like a
// mode or roster change (src/controllers/adminStepUp.ts), because it cannot
// be undone and may take real people's input with it; it is recorded in the
// hub's own admin log.

import { useEffect, useState } from "react";
import {
  adminGetSampleContent,
  adminRemoveSampleContent,
  adminRequestSampleRemovalCode,
  type SampleContentSummary,
} from "../../services/api";
import { SampleRemovalWarning } from "./sampleWarning";

export default function SampleContentSection() {
  const [summary, setSummary] = useState<SampleContentSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  function load() {
    adminGetSampleContent()
      .then(setSummary)
      .catch((e: Error) => setLoadError(e.message));
  }
  useEffect(load, []);

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

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Sample content</h2>
      {!summary ? (
        <p className="form-hint">Loading…</p>
      ) : summary.processes === 0 ? (
        <>
          <p className="form-hint">This hub has no sample content.</p>
          {message && !message.error && (
            <p className="admin-settings-message" role="status">
              {message.text}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="form-hint">
            This hub has {summary.processes} sample {summary.processes === 1 ? "process" : "processes"}: illustrative
            votes, proposals and announcements, each marked <strong>Sample</strong>, so the hub did not open empty.
            They are not public record: they never appear in the hub's public event feed, its export or residents'
            email digests.
          </p>

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
