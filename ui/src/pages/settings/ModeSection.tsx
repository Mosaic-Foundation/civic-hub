// Mode — who may sign in: beta (the allowlist) or live (anyone).
//
// Not a SectionForm: mode is a column on the hub row, changed through
// POST /admin/hub/mode with a fresh emailed code (src/controllers/adminStepUp.ts),
// because it decides who may sign in at all. The beta allowlist and the
// waitlist live here too — they only mean anything in beta.
//
// A demo hub may graduate to beta or live from here (Adam, 2026-09-24,
// matching the build plan). Demo is never offered as a choice, and the page
// says the move cannot be undone: a trigger on `hubs` refuses any move back
// into demo, for the platform as well as the hub's admins.
//
// Before the code (leaving-demo slice, 2026-10-15): every move up shows what
// must be in place, each with a link to where it is set, and what the switch
// will do, in plain words with real counts (src/services/modeReadiness.ts).
// The time zone and postal address block; everything else may be accepted
// as it is, for this switch. "Email me a code" stays off until then. Going
// back from live to beta shows only what it does: who gets locked out.

import HelpButton from "../../components/HelpButton";
import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi";
import { Link } from "react-router-dom";
import {
  adminGetModeReadiness,
  adminGetSampleContent,
  adminGetSettings,
  adminPatchSettings,
  adminRequestModeCode,
  adminSetHubMode,
  type ModeReadiness,
  type SampleContentSummary,
  type WaitlistEntry,
} from "../../services/api";
import { useHubSettings, useUnsavedChangesGuard } from "./HubSettingsContext";
import { useAnchoredOpen } from "../../hooks/useAnchor";
import { SampleRemovalWarning } from "./sampleWarning";

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
  // Graduating out of demo asks the same question as Settings → Sample
  // content (Phase 7): keep the samples, or take them out with the move.
  const [removeSample, setRemoveSample] = useState<boolean | null>(null);
  // Leaving demo, and going live (2026-10-15): what must be in place, what
  // the admin accepts as it is for this switch, and what the switch will do.
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const [tellWaitlist, setTellWaitlist] = useState(true);

  useEffect(() => {
    if (mode) setPending(mode);
  }, [mode]);

  const { data: sampleRead } = useApi<SampleContentSummary>(mode === "demo" ? "admin/sample-content" : null, () =>
    adminGetSampleContent(),
  );
  const sample = sampleRead ?? null;

  const asksAboutSample = mode === "demo" && !!sample && sample.processes + (sample.added_in_demo ?? 0) > 0;

  const changing = !!mode && pending !== mode;
  useEffect(() => setDirty("mode", changing), [changing, setDirty]);
  useEffect(() => () => setDirty("mode", false), [setDirty]);
  useUnsavedChangesGuard(changing);

  // Read afresh for every choice: each item may have been set in another
  // section since, and the counts in the consequences change.
  const { data: readinessRead, error: readinessFailure } = useApi<ModeReadiness>(
    changing ? `admin/mode-readiness/${pending}` : null,
    () => adminGetModeReadiness(pending),
  );
  const readiness = readinessRead ?? null;
  const readinessError = readinessFailure?.message ?? null;

  const items = readiness?.items ?? [];
  const blocked = items.filter((i) => i.blocking && !i.done);
  const open = items.filter(
    (i) => !i.done && !i.blocking && !(i.id === "samples" ? removeSample !== null : accepted.has(i.id)),
  );
  const ready = !!readiness && blocked.length === 0 && open.length === 0;

  function toggleAccepted(id: string, on: boolean) {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

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
      const acceptedNow = [...accepted];
      if (asksAboutSample && removeSample === false) acceptedNow.push("samples");
      const saved = await adminSetHubMode(pending, code.trim(), {
        removeSampleContent: asksAboutSample && removeSample === true,
        accepted: acceptedNow,
        tellWaitlist,
      });
      const from = mode;
      await reload();
      setCode("");
      setCodeSent(false);
      setAccepted(new Set());
      setRemoveSample(null);
      const told = saved.waitlist?.told ?? 0;
      setMessage({
        text:
          saved.mode === "beta"
            ? `Switched to beta. Only admins, officials, board members and the allowlist can sign in now; everyone else is offered the waitlist.`
            : `Switched to live. Anyone can sign in, and the ${from === "demo" ? "demo" : "beta"} notice is gone.${
                told > 0 ? ` ${told} ${told === 1 ? "person" : "people"} on the waitlist ${told === 1 ? "was" : "were"} told the hub is open.` : ""
              }`,
        error: false,
      });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Could not change the mode", error: true });
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setRemoveSample(null);
    setAccepted(new Set());
    setTellWaitlist(true);
    setPending(mode);
    setCode("");
    setCodeSent(false);
    setMessage(null);
  }

  if (error) return <p className="form-error">{error}</p>;

  return (
    <>
      <section className="settings-section">
        <h2 className="settings-section-title">
          Mode
          <HelpButton k="settings.mode" label="Mode" />
        </h2>

        {!data ? (
          <p className="form-hint">Loading…</p>
        ) : (
          <>
            {mode === "demo" ? (
              <>
                <p className="settings-mode-current">
                  This hub is in <strong>demo mode</strong>, set by the platform.
                </p>
                <p className="form-hint">
                  A demo hub accepts any six digits instead of emailing a
                  code, so anyone can look around without an inbox. You can
                  move it to beta or live below, which turns real email
                  verification on for everyone.{" "}
                  <strong>No one can put a hub back into demo</strong>, not
                  this hub's admins and not the platform, so this cannot be
                  undone.
                </p>
              </>
            ) : (
              <p className="form-hint">
                Who may sign in to this hub. Both modes send a real code by
                email; they differ in who is let in.
              </p>
            )}

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
                      setAccepted(new Set());
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

            {changing && readinessError && <p className="form-error">{readinessError}</p>}
            {changing && !readiness && !readinessError && <p className="form-hint">Checking what this hub has in place…</p>}

            {changing && readiness && items.length > 0 && (
              <div className="mode-readiness" role="region" aria-label={`Before you switch to ${pending}`}>
                <h3 className="settings-subsection-title">
                  Before you switch to {pending}
                  <HelpButton k="mode.readiness" label="Before you switch" />
                </h3>
                <p className="form-hint">
                  {blocked.length > 0
                    ? `${blocked.length === 1 ? "One thing has" : `${blocked.length} things have`} to be set first. Everything else you can finish now, or accept as it is for this switch.`
                    : open.length > 0
                      ? "Finish each item, or tick it to accept it as it is for this switch. What you accept is recorded in the admin log."
                      : "Everything is in place or accepted."}
                </p>
                <ul className="mode-readiness-list">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className={`mode-readiness-item${item.done ? " is-done" : item.blocking ? " is-blocking" : ""}`}
                      data-item={item.id}
                    >
                      <span className="mode-readiness-mark" aria-hidden="true">
                        {item.done ? "✓" : item.blocking ? "!" : "○"}
                      </span>
                      <span className="mode-readiness-what">
                        <strong>{item.title}</strong>
                        <span className="visually-hidden">
                          {item.done ? " (done)" : item.blocking ? " (must be set first)" : " (not done)"}
                        </span>
                        <span className="mode-readiness-detail">{item.detail}</span>
                        {!item.done && item.id !== "samples" && (
                          <Link to={item.link} className="mode-readiness-link">
                            {item.blocking ? `Set it in ${item.link_label}` : `Open ${item.link_label}`}
                          </Link>
                        )}
                        {!item.done && !item.blocking && item.id !== "samples" && item.accept_label && (
                          <label className="mode-readiness-accept">
                            <input
                              type="checkbox"
                              checked={accepted.has(item.id)}
                              disabled={saving || codeSent}
                              onChange={(e) => toggleAccepted(item.id, e.target.checked)}
                            />
                            {item.accept_label}
                          </label>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {changing && asksAboutSample && sample && (
              <fieldset className="settings-mode-choices" disabled={saving || codeSent}>
                <legend className="settings-subsection-title">
                  What about the {sample.processes} sample {sample.processes === 1 ? "process" : "processes"}?
                </legend>
                <label className={`settings-mode-choice${removeSample === false ? " is-selected" : ""}`}>
                  <input
                    type="radio"
                    name="graduate-sample"
                    checked={removeSample === false}
                    onChange={() => setRemoveSample(false)}
                  />
                  <span>
                    <span className="settings-mode-title">Keep them for now</span>
                    <span className="settings-mode-body">
                      They stay marked Sample. You can remove them any time from Hub settings → Sample content.
                    </span>
                  </span>
                </label>
                <label className={`settings-mode-choice${removeSample === true ? " is-selected" : ""}`}>
                  <input
                    type="radio"
                    name="graduate-sample"
                    checked={removeSample === true}
                    onChange={() => setRemoveSample(true)}
                  />
                  <span>
                    <span className="settings-mode-title">Remove them with this change</span>
                    <span className="settings-mode-body">Deleted before the new mode takes effect.</span>
                  </span>
                </label>
                {removeSample === true && <SampleRemovalWarning summary={sample} />}
              </fieldset>
            )}

            {changing && readiness && readiness.consequences.lines.length > 0 && (
              <div className="mode-consequences" role="region" aria-label="What happens when you switch">
                <h3 className="settings-subsection-title">
                  What happens when you switch to {pending}
                  <HelpButton k="mode.switch" label="What happens when you switch" />
                </h3>
                <ul className="mode-consequences-list">
                  {readiness.consequences.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {pending === "live" && readiness.consequences.waitlist_to_tell > 0 && (
                  <label className="mode-readiness-accept">
                    <input
                      type="checkbox"
                      checked={tellWaitlist}
                      disabled={saving || codeSent}
                      onChange={(e) => setTellWaitlist(e.target.checked)}
                    />
                    Email the {readiness.consequences.waitlist_to_tell}{" "}
                    {readiness.consequences.waitlist_to_tell === 1 ? "person" : "people"} on the waitlist that the hub is
                    open (they were promised it)
                  </label>
                )}
              </div>
            )}

            {(changing || codeSent || message) && (
            <div className="settings-form-footer">
              {changing && (
                <p className="form-hint">
                  Changing who may sign in takes a code emailed to you now. An
                  open admin tab is not enough on its own.
                  {mode === "demo" && <> This hub cannot return to demo afterwards.</>}
                </p>
              )}
              <div className="admin-settings-actions">
                {changing && !codeSent && (
                  <button
                    type="button"
                    className="admin-convert-button"
                    onClick={requestCode}
                    disabled={saving || !ready}
                  >
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

      <AllowlistAndWaitlist live={mode === "live"} />
    </>
  );
}

/**
 * The beta allowlist (its own save) and the waitlist (read-only). Both are
 * collapsed by default — on a live beta they run to dozens of rows and push
 * everything below them off the screen — and each scrolls inside a capped
 * height when opened. The allowlist is edited one address per line (commas
 * are still accepted on save).
 */
function AllowlistAndWaitlist({ live }: { live: boolean }) {
  const { setDirty } = useHubSettings();
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState("");
  const [text, setText] = useState("");
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  // Closed until clicked, or until a link names them (#allowlist, #waitlist).
  const [allowOpen, setAllowOpen] = useAnchoredOpen("allowlist");
  const [waitOpen, setWaitOpen] = useAnchoredOpen("waitlist");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const allowCount = saved ? saved.split("\n").length : 0;

  useEffect(() => {
    adminGetSettings()
      .then((s) => {
        const joined = s.beta_allowlist.join("\n");
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
      const joined = result.beta_allowlist.join("\n");
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
      <details
        id="allowlist"
        data-anchor=""
        className="settings-section settings-section--follow settings-collapsible"
        open={allowOpen}
        onToggle={(e) => setAllowOpen(e.currentTarget.open)}
      >
        <summary className="settings-collapsible-summary">
          <h3 className="settings-subsection-title">
            Beta allowlist
            <HelpButton k="mode.allowlist" label="Beta allowlist" />
          </h3>
          <span className="settings-collapsible-count">
            {loaded ? `${allowCount} ${allowCount === 1 ? "address" : "addresses"}` : "…"}
            {dirty && " · unsaved"}
          </span>
        </summary>
        <p className="form-hint">
          Who may sign in while this hub is in beta, one address per line.
          Admins, officials and board members can always sign in.
          {live && <> This hub is live, so the list does nothing until it goes back to beta.</>}
        </p>
        <textarea
          className="form-textarea settings-list-textarea"
          rows={10}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setMessage(null);
          }}
          disabled={!loaded || saving}
          placeholder={"friend@example.com\ntester@example.com"}
          aria-label="Beta allowlist"
          spellCheck={false}
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
      </details>

      <details
        id="waitlist"
        data-anchor=""
        className="settings-section settings-section--follow settings-collapsible"
        open={waitOpen}
        onToggle={(e) => setWaitOpen(e.currentTarget.open)}
      >
        <summary className="settings-collapsible-summary">
          <h3 className="settings-subsection-title">
            Waitlist
            <HelpButton k="mode.waitlist" label="Waitlist" />
          </h3>
          <span className="settings-collapsible-count">
            {loaded ? `${waitlist.length} ${waitlist.length === 1 ? "person" : "people"}` : "…"}
          </span>
        </summary>
        <p className="form-hint">
          People who asked for access while the hub was in beta.
          {live
            ? " This hub is live: anyone can sign in now, and the people here were emailed when it opened unless you chose not to."
            : " When the hub goes live, you can email them that it is open."}
        </p>
        {waitlist.length === 0 ? (
          <p className="empty-state-inline">No one on the waitlist yet.</p>
        ) : (
          <>
            <div className="admin-waitlist-table-wrap settings-list-scroll">
              <table className="admin-waitlist-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Signed up</th>
                    <th>Test user</th>
                    <th>Invited by</th>
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
                      <td>{w.invited_by_name ?? "—"}</td>
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
      </details>
    </>
  );
}
