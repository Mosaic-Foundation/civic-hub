// Mode — who may sign in: beta (the allowlist) or live (anyone).
//
// Not a SectionForm: mode is a column on the hub row, changed through
// POST /admin/hub/mode with a fresh emailed code (src/controllers/adminStepUp.ts),
// because it decides who may sign in at all. The beta allowlist and the
// waitlist live here too — they only mean anything in beta.
//
// A demo hub shows its mode and no control. Demo is the one mode that turns
// email verification off, so only the platform puts a hub into it, and this
// page does not offer a way out of it either (Adam, 2026-09-24): a demo hub's
// graduation is arranged with the platform.

import { useEffect, useState } from "react";
import {
  adminGetSettings,
  adminPatchSettings,
  adminRequestModeCode,
  adminSetHubMode,
  type WaitlistEntry,
} from "../../services/api";
import { useHubSettings, useUnsavedChangesGuard } from "./HubSettingsContext";

const MODES: ReadonlyArray<{ id: "beta" | "live"; title: string; body: string }> = [
  {
    id: "beta",
    title: "Beta",
    body: "Only people on the allowlist below can sign in. Everyone else is offered the waitlist. Pages show a beta banner, and the hub's email goes only to its admins and the allowlist.",
  },
  {
    id: "live",
    title: "Live",
    body: "Anyone can sign in with a code sent to their email. No banner. This is the mode for a hub that is open to its whole community.",
  },
];

export default function ModeSection() {
  const { data, error, reload, setDirty } = useHubSettings();
  const mode = data?.hub.mode ?? "";

  const [pending, setPending] = useState<string>("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    if (mode) setPending(mode);
  }, [mode]);

  const changing = !!mode && pending !== mode;
  useEffect(() => setDirty("mode", changing), [changing, setDirty]);
  useEffect(() => () => setDirty("mode", false), [setDirty]);
  useUnsavedChangesGuard(changing);

  async function requestCode() {
    setMessage(null);
    try {
      const { message: sent } = await adminRequestModeCode();
      setCodeSent(true);
      setMessage({ text: sent, error: false });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Could not send a code", error: true });
    }
  }

  async function confirm() {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await adminSetHubMode(pending, code.trim());
      await reload();
      setCode("");
      setCodeSent(false);
      setMessage({
        text:
          saved.mode === "beta"
            ? "Saved. Only people on the allowlist can sign in now; everyone else is offered the waitlist."
            : "Saved. Anyone can sign in, and the beta banner is gone.",
        error: false,
      });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Could not change the mode", error: true });
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setPending(mode);
    setCode("");
    setCodeSent(false);
    setMessage(null);
  }

  if (error) return <p className="form-error">{error}</p>;

  return (
    <>
      <section className="settings-section">
        <h2 className="settings-section-title">Mode</h2>

        {!data ? (
          <p className="form-hint">Loading…</p>
        ) : mode === "demo" ? (
          <>
            <p className="settings-mode-current">
              <strong>Demo mode, set by the platform.</strong>
            </p>
            <p className="form-hint">
              A demo hub accepts any six digits instead of emailing a code, so
              anyone can look around without an inbox. Because that turns
              email verification off, only the platform puts a hub into demo
              or takes it out. Nothing here changes it.
            </p>
          </>
        ) : (
          <>
            <p className="form-hint">
              Who may sign in to this hub. Both modes send a real code by
              email; they differ in who is let in.
            </p>

            <fieldset className="settings-mode-choices" disabled={saving || codeSent}>
              <legend className="visually-hidden">Mode</legend>
              {MODES.map((m) => (
                <label
                  key={m.id}
                  className={`settings-mode-choice${pending === m.id ? " is-selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="hub-mode"
                    value={m.id}
                    checked={pending === m.id}
                    onChange={() => {
                      setPending(m.id);
                      setMessage(null);
                    }}
                  />
                  <span>
                    <span className="settings-mode-title">
                      {m.title}
                      {mode === m.id && <span className="settings-mode-badge">Current</span>}
                    </span>
                    <span className="settings-mode-body">{m.body}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {(changing || codeSent || message) && (
            <div className="settings-form-footer">
              {changing && (
                <p className="form-hint">
                  Changing who may sign in takes a code emailed to you now. An
                  open admin tab is not enough on its own.
                </p>
              )}
              <div className="admin-settings-actions">
                {changing && !codeSent && (
                  <button type="button" className="admin-convert-button" onClick={requestCode} disabled={saving}>
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
                      disabled={saving}
                      style={{ maxWidth: "160px" }}
                    />
                    <button
                      type="button"
                      className="admin-convert-button"
                      onClick={confirm}
                      disabled={saving || code.trim().length === 0}
                    >
                      {saving ? "Saving…" : `Switch to ${pending}`}
                    </button>
                  </>
                )}
                {(changing || codeSent) && (
                  <button type="button" className="admin-remove-section" onClick={cancel} disabled={saving}>
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
            )}
          </>
        )}
      </section>

      <AllowlistAndWaitlist />
    </>
  );
}

/** The beta allowlist (its own save) and the waitlist (read-only). */
function AllowlistAndWaitlist() {
  const { setDirty } = useHubSettings();
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState("");
  const [text, setText] = useState("");
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    adminGetSettings()
      .then((s) => {
        const joined = s.beta_allowlist.join(", ");
        setSaved(joined);
        setText(joined);
        setWaitlist(s.waitlist);
        setLoaded(true);
      })
      .catch((err: Error) => setMessage({ text: `Could not load the allowlist: ${err.message}`, error: true }));
  }, []);

  const dirty = loaded && text !== saved;
  useEffect(() => setDirty("mode-allowlist", dirty), [dirty, setDirty]);
  useEffect(() => () => setDirty("mode-allowlist", false), [setDirty]);
  useUnsavedChangesGuard(dirty);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const input = text
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const result = await adminPatchSettings({ beta_allowlist: input });
      const joined = result.beta_allowlist.join(", ");
      setSaved(joined);
      setText(joined);
      setMessage({
        text:
          result.beta_allowlist.length === 0
            ? "Cleared. In beta, only admins can sign in now."
            : `Saved. ${result.beta_allowlist.length} address${result.beta_allowlist.length === 1 ? "" : "es"} on the allowlist.`,
        error: false,
      });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Could not save the allowlist", error: true });
    } finally {
      setSaving(false);
    }
  }

  function copyEmails() {
    navigator.clipboard.writeText(waitlist.map((w) => w.email).join(", ")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <>
      <section className="settings-section settings-section--follow">
        <h3 className="settings-subsection-title">Beta allowlist</h3>
        <p className="form-hint">
          Who may sign in while this hub is in beta, comma- or line-separated.
          Admins can always sign in.
        </p>
        <textarea
          className="form-textarea"
          rows={3}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setMessage(null);
          }}
          disabled={!loaded || saving}
          placeholder="friend@example.com, tester@example.com"
          aria-label="Beta allowlist"
        />
        <div className="settings-form-footer">
          <div className="admin-settings-actions">
            <button type="button" className="admin-convert-button" onClick={save} disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save allowlist"}
            </button>
            {dirty && !message && <span className="settings-unsaved">Unsaved changes</span>}
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
      </section>

      <section className="settings-section settings-section--follow">
        <h3 className="settings-subsection-title">Waitlist</h3>
        <p className="form-hint">People who asked for access from the beta landing page.</p>
        {waitlist.length === 0 ? (
          <p className="empty-state-inline">No one on the waitlist yet.</p>
        ) : (
          <>
            <div className="admin-waitlist-table-wrap">
              <table className="admin-waitlist-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Signed up</th>
                    <th>Test user</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {waitlist.map((w) => (
                    <tr key={w.email}>
                      <td>{w.name ?? "—"}</td>
                      <td>{w.email}</td>
                      <td>{new Date(w.created_at).toLocaleDateString()}</td>
                      <td>{w.wants_test_user ? "Yes" : "—"}</td>
                      <td>{w.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="admin-settings-actions" style={{ marginTop: "var(--space-sm)" }}>
              <button type="button" className="admin-convert-button" onClick={copyEmails}>
                {copied ? "Copied!" : "Copy all emails"}
              </button>
              <span className="form-hint">
                {waitlist.length} {waitlist.length === 1 ? "person" : "people"}
              </span>
            </div>
          </>
        )}
      </section>
    </>
  );
}
