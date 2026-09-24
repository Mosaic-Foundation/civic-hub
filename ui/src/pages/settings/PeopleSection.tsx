// Admins & board — the hub's roster. A roster change is the one edit on this
// page that takes a fresh emailed code, so it carries its own little state
// machine: edit the lists, ask for a code, type it in, save. See
// src/controllers/adminStepUp.ts.

import { useEffect, useState } from "react";
import {
  adminGetHubPeople,
  adminRequestPeopleCode,
  adminSetHubPeople,
} from "../../services/api";
import { useHubSettings, useUnsavedChangesGuard } from "./HubSettingsContext";

export default function PeopleSection() {
  const { setDirty } = useHubSettings();

  const [adminEmails, setAdminEmails] = useState<string[]>([]);
  const [boardEmails, setBoardEmails] = useState<string[]>([]);
  const [adminsFromEnv, setAdminsFromEnv] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [peopleCode, setPeopleCode] = useState("");
  const [peopleCodeSent, setPeopleCodeSent] = useState(false);
  const [savingPeople, setSavingPeople] = useState(false);
  const [peopleMessage, setPeopleMessage] = useState<string | null>(null);

  useEffect(() => {
    adminGetHubPeople()
      .then((p) => {
        setAdminEmails(p.admin_emails);
        setBoardEmails(p.board_emails);
        setAdminsFromEnv(p.admins_from_env);
        setSavedSnapshot(JSON.stringify({ admin_emails: p.admin_emails, board_emails: p.board_emails }));
      })
      .catch((err: Error) => {
        setPeopleMessage(`Could not load the roster: ${err.message}`);
      });
  }, []);

  // Nothing is dirty until the roster has loaded: the empty snapshot would
  // otherwise read as a change, and stay one if the load failed.
  const dirty =
    savedSnapshot !== "" &&
    (JSON.stringify({ admin_emails: adminEmails, board_emails: boardEmails }) !== savedSnapshot ||
      peopleCodeSent);
  useEffect(() => setDirty("people", dirty), [dirty, setDirty]);
  useEffect(() => () => setDirty("people", false), [setDirty]);
  useUnsavedChangesGuard(dirty);

  async function requestPeopleCode() {
    setPeopleMessage(null);
    try {
      const { message } = await adminRequestPeopleCode();
      setPeopleCodeSent(true);
      setPeopleMessage(message);
    } catch (err) {
      setPeopleMessage(
        err instanceof Error ? err.message : "Could not send a code",
      );
    }
  }

  async function savePeople() {
    setSavingPeople(true);
    setPeopleMessage(null);
    try {
      const saved = await adminSetHubPeople({
        admin_emails: adminEmails.map((e) => e.trim()).filter(Boolean),
        board_emails: boardEmails.map((e) => e.trim()).filter(Boolean),
        code: peopleCode.trim(),
      });
      setAdminEmails(saved.admin_emails);
      setBoardEmails(saved.board_emails);
      setAdminsFromEnv(saved.admins_from_env);
      setSavedSnapshot(
        JSON.stringify({ admin_emails: saved.admin_emails, board_emails: saved.board_emails }),
      );
      setPeopleCode("");
      setPeopleCodeSent(false);
      setPeopleMessage(
        `Saved. ${saved.admin_emails.length} admin${saved.admin_emails.length === 1 ? "" : "s"}, ` +
          `${saved.board_emails.length} board member${saved.board_emails.length === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      setPeopleMessage(
        err instanceof Error ? err.message : "Failed to save the roster",
      );
    } finally {
      setSavingPeople(false);
    }
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Admins & board</h2>

      <p className="form-hint">
        Admins reach every page under /admin and can post announcements.
        Board members can post announcements and are offered as brief
        recipients; they cannot reach admin pages. Both lists belong to
        this hub — an admin here is not an admin on any other hub.
      </p>
      {adminsFromEnv && (
        <p className="form-hint">
          <strong>This hub has no roster of its own yet</strong>, so the
          admins below come from the deployment's CIVIC_ADMIN_EMAILS.
          Saving writes a roster for this hub and the deployment variable
          stops applying to it.
        </p>
      )}

      <EmailListEditor
        label="Admins"
        addLabel="+ Add admin"
        emails={adminEmails}
        onChange={setAdminEmails}
        disabled={savingPeople}
        minimum={1}
        minimumHint="A hub must keep at least one admin."
      />

      <EmailListEditor
        label="Board members"
        addLabel="+ Add board member"
        emails={boardEmails}
        onChange={setBoardEmails}
        disabled={savingPeople}
      />

      <p className="form-hint" style={{ marginTop: "var(--space-md)" }}>
        Changing who administers a hub takes a code emailed to you now —
        an open admin tab is not enough on its own.
      </p>
      <div className="admin-settings-actions">
        {!peopleCodeSent ? (
          <button
            type="button"
            className="admin-convert-button"
            onClick={requestPeopleCode}
            disabled={savingPeople}
          >
            Email me a code
          </button>
        ) : (
          <>
            <input
              className="form-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={peopleCode}
              onChange={(e) => setPeopleCode(e.target.value)}
              placeholder="6-digit code"
              aria-label="Confirmation code"
              disabled={savingPeople}
              style={{ maxWidth: "160px" }}
            />
            <button
              type="button"
              className="admin-convert-button"
              onClick={savePeople}
              disabled={savingPeople || peopleCode.trim().length === 0}
            >
              {savingPeople ? "Saving…" : "Save roster"}
            </button>
            <button
              type="button"
              className="admin-remove-section"
              onClick={() => {
                setPeopleCodeSent(false);
                setPeopleCode("");
                setPeopleMessage(null);
              }}
              disabled={savingPeople}
            >
              Cancel
            </button>
          </>
        )}
        {peopleMessage && (
          <span className="admin-settings-message">{peopleMessage}</span>
        )}
      </div>
    </section>
  );
}

/**
 * A list of email addresses with add and remove. Two of them, so it is a
 * component rather than the same twenty lines written twice.
 *
 * `minimum` guards the last admin in the UI. The server guards it too — this
 * one only saves the admin a round trip and tells them why the button is
 * disabled, which an error after the fact would not.
 */
function EmailListEditor({
  label,
  addLabel,
  emails,
  onChange,
  disabled,
  minimum = 0,
  minimumHint,
}: {
  label: string;
  addLabel: string;
  emails: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
  minimum?: number;
  minimumHint?: string;
}) {
  const atMinimum = emails.length <= minimum;
  return (
    <div style={{ marginTop: "var(--space-md)" }}>
      <label className="form-label">{label}</label>
      {emails.length === 0 && (
        <p className="empty-state-inline" style={{ margin: "var(--space-sm) 0" }}>
          None.
        </p>
      )}
      {emails.map((email, i) => (
        <div
          key={i}
          style={{ display: "flex", gap: "var(--space-sm)", marginBottom: "var(--space-sm)" }}
        >
          <input
            className="form-input"
            type="email"
            value={email}
            onChange={(e) =>
              onChange(emails.map((v, idx) => (idx === i ? e.target.value : v)))
            }
            placeholder="name@example.com"
            aria-label={`${label} ${i + 1}`}
            disabled={disabled}
            style={{ maxWidth: "360px" }}
          />
          <button
            type="button"
            className="admin-remove-section"
            onClick={() => onChange(emails.filter((_, idx) => idx !== i))}
            disabled={disabled || atMinimum}
            aria-label={`Remove ${label} ${i + 1}`}
            title={atMinimum ? minimumHint : undefined}
          >
            ×
          </button>
        </div>
      ))}
      {atMinimum && minimumHint && (
        <p className="form-hint">{minimumHint}</p>
      )}
      <button
        type="button"
        className="admin-add-section"
        onClick={() => onChange([...emails, ""])}
        disabled={disabled}
      >
        {addLabel}
      </button>
    </div>
  );
}
