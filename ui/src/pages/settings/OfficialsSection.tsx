// Officials & brief recipients.
//
// One section (Adam, 2026-09-06): the officials ARE the default brief
// recipients. Each row carries a "sends briefs" flag; the hub-wide
// recipient list is derived on save as the flagged officials plus any
// standing addresses without an account (a clerk, a shared inbox). The
// review page still lets the admin adjust the list per brief.

import { useEffect, useState } from "react";
import {
  adminGetSettings,
  adminPatchSettings,
  type Official,
} from "../../services/api";
import {
  OFFICIAL_TYPES,
  OFFICIAL_TYPE_LABELS,
  type OfficialType,
} from "../../../../src/shared/officialTypes";
import { useHubSettings, useUnsavedChangesGuard } from "./HubSettingsContext";

type OfficialRow = Official & { sends_briefs: boolean };

export default function OfficialsSection() {
  const { setDirty } = useHubSettings();

  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [officials, setOfficials] = useState<OfficialRow[]>([]);
  const [extraRecipientsText, setExtraRecipientsText] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [savingOfficials, setSavingOfficials] = useState(false);
  const [officialsMessage, setOfficialsMessage] = useState<string | null>(null);

  useEffect(() => {
    adminGetSettings()
      .then((s) => {
        const recipients = new Set(s.brief_recipient_emails.map((e) => e.toLowerCase()));
        const officialEmails = new Set(s.officials.map((o) => o.email.toLowerCase()));
        const nextOfficials = s.officials.map((o) => ({
          ...o,
          sends_briefs: recipients.has(o.email.toLowerCase()),
        }));
        const nextExtra = s.brief_recipient_emails
          .filter((e) => !officialEmails.has(e.toLowerCase()))
          .join(", ");
        setOfficials(nextOfficials);
        setExtraRecipientsText(nextExtra);
        setSavedSnapshot(JSON.stringify({ officials: nextOfficials, extra: nextExtra }));
        setAvailable(s.officials_available);
        setLoaded(true);
      })
      .catch((err: Error) => {
        setError(`Could not load settings: ${err.message}`);
      });
  }, []);

  const dirty =
    loaded &&
    JSON.stringify({ officials, extra: extraRecipientsText }) !== savedSnapshot;
  useEffect(() => setDirty("officials", dirty), [dirty, setDirty]);
  useEffect(() => () => setDirty("officials", false), [setDirty]);
  useUnsavedChangesGuard(dirty);

  function updateOfficial(i: number, patch: Partial<OfficialRow>) {
    setOfficials((cur) => cur.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }

  function addOfficial() {
    setOfficials((cur) => [
      ...cur,
      {
        email: "",
        name: "",
        official_type: "board_of_supervisors",
        official_title: OFFICIAL_TYPE_LABELS.board_of_supervisors,
        sends_briefs: true,
      },
    ]);
  }

  function removeOfficial(i: number) {
    setOfficials((cur) => cur.filter((_, idx) => idx !== i));
  }

  async function saveOfficials() {
    setSavingOfficials(true);
    setOfficialsMessage(null);
    try {
      const cleaned: Official[] = [];
      const recipientEmails: string[] = [];
      for (const o of officials) {
        const email = o.email.trim();
        const name = (o.name ?? "").trim();
        const title = o.official_title.trim();
        // A fully blank row is a row the admin added and abandoned —
        // drop it rather than making them delete it to save.
        if (!email && !name && !title) continue;
        if (!email || !title) {
          throw new Error("Each official needs both an email and a title.");
        }
        cleaned.push({
          email,
          name: name || null,
          official_type: o.official_type,
          official_title: title,
        });
        if (o.sends_briefs) recipientEmails.push(email);
      }
      const extras = extraRecipientsText
        .split(/[,\n]/)
        .map((e) => e.trim())
        .filter((e) => e.length > 0);
      // Where the roster is not this hub's to edit yet, only the standing
      // brief addresses are saved; they are a per-hub setting already.
      const saved = await adminPatchSettings(
        available
          ? { officials: cleaned, brief_recipient_emails: [...recipientEmails, ...extras] }
          : { brief_recipient_emails: extras },
      );
      const recipients = new Set(saved.brief_recipient_emails.map((e) => e.toLowerCase()));
      const officialEmails = new Set(saved.officials.map((o) => o.email.toLowerCase()));
      const nextOfficials = saved.officials.map((o) => ({
        ...o,
        sends_briefs: recipients.has(o.email.toLowerCase()),
      }));
      const nextExtra = saved.brief_recipient_emails
        .filter((e) => !officialEmails.has(e.toLowerCase()))
        .join(", ");
      setOfficials(nextOfficials);
      setExtraRecipientsText(nextExtra);
      setSavedSnapshot(JSON.stringify({ officials: nextOfficials, extra: nextExtra }));
      const n = saved.brief_recipient_emails.length;
      setOfficialsMessage(
        available
          ? `Saved. ${saved.officials.length} official(s); briefs go to ${n} recipient${n === 1 ? "" : "s"} by default.`
          : `Saved. Briefs go to ${n} standing address${n === 1 ? "" : "es"} by default.`,
      );
    } catch (err) {
      setOfficialsMessage(
        err instanceof Error ? err.message : "Failed to save officials",
      );
    } finally {
      setSavingOfficials(false);
    }
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Officials & brief recipients</h2>

      {error && <p className="form-error">{error}</p>}

      <p className="form-hint">
        Accounts that hold a public office. The title shows as a pill next
        to their name everywhere they post — announcements, proposals,
        projects, and comments — and they can post announcements and
        respond to briefs. Leave name blank to use the person's own
        account name. Admins can always post and only need to be listed
        here if they also hold an office (they will show both badges).
      </p>
      <p className="form-hint">
        Officials marked <strong>Receives briefs</strong> get an email
        from the hub each time a brief is published. You can add or remove
        recipients for a particular brief while reviewing it.
      </p>

      {loaded && !available ? (
        <p className="form-hint settings-note">
          <strong>Officials cannot be listed on this hub yet.</strong> Accounts
          are shared between hubs until the next phase of the multi-hub work,
          so a roster here would show, and could remove, another hub&apos;s
          officials. The standing brief addresses below are this hub&apos;s own
          and can be saved.
        </p>
      ) : (
        <>
      {officials.length === 0 && (
        <p className="empty-state-inline" style={{ margin: "var(--space-sm) 0" }}>
          No officials configured. Only admins can post announcements.
        </p>
      )}

      {officials.length > 0 && (
        <div className="official-row official-head" aria-hidden="true">
          <span className="official-col-label">Email</span>
          <span className="official-col-label">Name</span>
          <span className="official-col-label">Office</span>
          <span className="official-col-label">
            Title <span className="official-col-note">(public pill)</span>
          </span>
          <span className="official-col-label">Receives briefs</span>
          <span />
        </div>
      )}

      {officials.map((official, i) => (
        <div key={i} className="official-row">
          <input
            className="form-input"
            type="email"
            value={official.email}
            onChange={(e) => updateOfficial(i, { email: e.target.value })}
            placeholder="official@example.com"
            aria-label={`Official ${i + 1} email`}
            disabled={!loaded || savingOfficials}
          />
          <input
            className="form-input"
            type="text"
            value={official.name ?? ""}
            onChange={(e) => updateOfficial(i, { name: e.target.value })}
            placeholder="Name"
            aria-label={`Official ${i + 1} name`}
            disabled={!loaded || savingOfficials}
            maxLength={80}
          />
          <select
            className="form-input"
            value={official.official_type}
            onChange={(e) => {
              const nextType = e.target.value as OfficialType;
              // Keep the title in step while it still matches the old
              // office's default, so switching offices does the
              // obvious thing — but never clobber a title the admin
              // has customized ("Supervisor, District 3").
              const isDefaultTitle = OFFICIAL_TYPES.some(
                (t) => OFFICIAL_TYPE_LABELS[t] === official.official_title,
              );
              updateOfficial(i, {
                official_type: nextType,
                ...(isDefaultTitle
                  ? { official_title: OFFICIAL_TYPE_LABELS[nextType] }
                  : {}),
              });
            }}
            aria-label={`Official ${i + 1} office`}
            disabled={!loaded || savingOfficials}
          >
            {OFFICIAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {OFFICIAL_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <input
            className="form-input"
            type="text"
            value={official.official_title}
            onChange={(e) =>
              updateOfficial(i, { official_title: e.target.value })
            }
            placeholder="Town Council"
            aria-label={`Official ${i + 1} title`}
            disabled={!loaded || savingOfficials}
            maxLength={50}
          />
          <label className="official-sends-briefs">
            <input
              type="checkbox"
              checked={official.sends_briefs}
              onChange={(e) => updateOfficial(i, { sends_briefs: e.target.checked })}
              aria-label={`Official ${i + 1} receives briefs`}
              disabled={!loaded || savingOfficials}
            />
            <span className="official-sends-briefs-text">Receives briefs</span>
          </label>
          <button
            type="button"
            className="admin-remove-section"
            onClick={() => removeOfficial(i)}
            disabled={savingOfficials}
            aria-label={`Remove official ${i + 1}`}
          >
            ×
          </button>
        </div>
      ))}

      <button
        type="button"
        className="admin-add-section"
        onClick={addOfficial}
        disabled={!loaded || savingOfficials}
      >
        + Add official
      </button>

        </>
      )}

      <div className="official-extra-recipients">
        <label className="form-label" htmlFor="extra-brief-recipients">
          Also send briefs to{" "}
          <span className="official-col-note">
            (standing addresses that aren't a person's office — a clerk, a shared board inbox)
          </span>
        </label>
        <input
          id="extra-brief-recipients"
          className="form-input"
          type="text"
          value={extraRecipientsText}
          onChange={(e) => setExtraRecipientsText(e.target.value)}
          placeholder="clerk@example.gov, board@example.gov"
          disabled={!loaded || savingOfficials}
        />
      </div>

      <div className="admin-settings-actions" style={{ marginTop: "var(--space-md)" }}>
        <button
          type="button"
          className="admin-convert-button"
          onClick={saveOfficials}
          disabled={!loaded || savingOfficials}
        >
          {savingOfficials ? "Saving…" : "Save officials & recipients"}
        </button>
        {officialsMessage && (
          <span className="admin-settings-message">{officialsMessage}</span>
        )}
      </div>
    </section>
  );
}
