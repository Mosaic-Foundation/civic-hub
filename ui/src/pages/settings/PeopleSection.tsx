// Admins & board — the hub's roster. A roster change is the one edit on this
// page that takes a fresh emailed code, so it carries its own little state
// machine: edit the lists, ask for a code, type it in, save. See
// src/controllers/adminStepUp.ts.

import HelpButton from "../../components/HelpButton";
import { useEffect, useState } from "react";
import PatternAvatar from "../../components/PatternAvatar";
import "../Members.css";
import {
  adminGetHiddenMembers,
  adminGetHubPeople,
  adminRequestPeopleCode,
  adminSetHubPeople,
} from "../../services/api";
import { useHubSettings, useUnsavedChangesGuard } from "./HubSettingsContext";

export default function PeopleSection() {
  const { setDirty } = useHubSettings();

  const [adminEmails, setAdminEmails] = useState<string[]>([]);
  const [boardEmails, setBoardEmails] = useState<string[]>([]);
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
      setSavedSnapshot(
        JSON.stringify({ admin_emails: saved.admin_emails, board_emails: saved.board_emails }),
      );
      setPeopleCode("");
      setPeopleCodeSent(false);
      setPeopleMessage(
        `Saved. ${saved.admin_emails.length} admin${saved.admin_emails.length === 1 ? "" : "s"}, ` +
          `${saved.board_emails.length} board member${saved.board_emails.length === 1 ? "" : "s"}.` +
          (saved.invite_message ? ` ${saved.invite_message}` : ""),
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
      <h2 className="settings-section-title">
        Admins & board
        <HelpButton k="settings.people" label="Admins & board" />
      </h2>

      <p className="form-hint">
        Admins reach every page under /admin and can post announcements.
        Board members can post announcements and are offered as brief
        recipients; they cannot reach admin pages. Both lists belong to
        this hub — an admin here is not an admin on any other hub.
      </p>
      <p className="form-hint">
        A new admin gets an email saying so, with a link and the first steps.
        The platform operator can also add or remove admins, so a hub that
        loses all of its own can be handed back.
      </p>

      <EmailListEditor
        label="Admins"
        helpKey="people.admins"
        addLabel="+ Add admin"
        emails={adminEmails}
        onChange={setAdminEmails}
        disabled={savingPeople}
        minimum={1}
        minimumHint="A hub must keep at least one admin."
      />

      <EmailListEditor
        label="Board members"
        helpKey="people.board"
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

      <HiddenMembers />
    </section>
  );
}

/**
 * Members who hid themselves from the Members page and the home page's
 * stack (members and invites slice). Admins are the only people who see
 * them, here; still no addresses.
 */
function HiddenMembers() {
  const [data, setData] = useState<{ hidden: Array<{ avatar: string; name: string; is_admin: boolean }>; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    adminGetHiddenMembers()
      .then(setData)
      .catch((err: Error) => setError(`Could not load the members: ${err.message}`));
  }, []);
  return (
    <div className="admin-hidden-members" id="hidden-members" style={{ marginTop: "var(--space-lg)" }}>
      <h3 className="settings-subsection-title">
        Hidden members
        <HelpButton k="people.hidden_members" label="Hidden members" />
      </h3>
      {error && <p className="form-error">{error}</p>}
      {data && (
        <>
          <p className="form-hint">
            {data.count.toLocaleString()} {data.count === 1 ? "member" : "members"} in all.{" "}
            {data.hidden.length === 0
              ? "Nobody has hidden themselves from the Members page."
              : `${data.hidden.length === 1 ? "1 has" : `${data.hidden.length} have`} hidden themselves from the Members page and the home page. Only admins see them, here.`}
          </p>
          {data.hidden.length > 0 && (
            <ul className="members-list" aria-label="Hidden members">
              {data.hidden.map((m) => (
                <li key={m.avatar} className="members-item">
                  <PatternAvatar seed={m.avatar} size={32} />
                  <span className="members-name">{m.name}</span>
                  {m.is_admin && <span className="members-admin">Admin</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
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
  helpKey,
}: {
  label: string;
  helpKey: string;
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
      <div className="settings-field-label-row">
        <label className="form-label">{label}</label>
        <HelpButton k={helpKey} label={label} />
      </div>
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
