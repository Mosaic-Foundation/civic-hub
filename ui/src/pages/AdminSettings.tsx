// Admin settings page — hub-wide configuration.
//
// Holds all admin-editable settings that aren't tied to a single
// proposal or brief review flow. Today: brief recipient emails and the
// officials roster. Future additions (theme, jurisdiction, email
// templates, etc.) should land here too.

import { useEffect, useState } from "react";
import {
  adminGetSettings,
  adminPatchSettings,
  type Official,
  type WaitlistEntry,
  type CommentIdentityMode,
} from "../services/api";
import {
  OFFICIAL_TYPES,
  OFFICIAL_TYPE_LABELS,
  type OfficialType,
} from "../../../src/shared/officialTypes";
import AdminTabs from "../components/AdminTabs";
import "./AdminSettings.css";

export default function AdminSettings() {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Brief recipients ---
  const [recipientsText, setRecipientsText] = useState("");
  const [savingRecipients, setSavingRecipients] = useState(false);
  const [recipientsMessage, setRecipientsMessage] = useState<string | null>(null);

  // --- Officials ---
  const [officials, setOfficials] = useState<Official[]>([]);
  const [savingOfficials, setSavingOfficials] = useState(false);
  const [officialsMessage, setOfficialsMessage] = useState<string | null>(null);

  // --- Support threshold ---
  const [threshold, setThreshold] = useState(5);
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [thresholdMessage, setThresholdMessage] = useState<string | null>(null);

  // --- Beta allowlist ---
  const [allowlistText, setAllowlistText] = useState("");
  const [savingAllowlist, setSavingAllowlist] = useState(false);
  const [allowlistMessage, setAllowlistMessage] = useState<string | null>(null);

  // --- Waitlist ---
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [copiedWaitlist, setCopiedWaitlist] = useState(false);

  // --- Comment identity ---
  const [identityMode, setIdentityMode] =
    useState<CommentIdentityMode>("anonymous_optional");
  const [savingIdentityMode, setSavingIdentityMode] = useState(false);
  const [identityModeMessage, setIdentityModeMessage] = useState<string | null>(null);

  useEffect(() => {
    adminGetSettings()
      .then((s) => {
        setRecipientsText(s.brief_recipient_emails.join(", "));
        setOfficials(s.officials);
        setThreshold(s.support_threshold);
        setAllowlistText(s.beta_allowlist.join(", "));
        setWaitlist(s.waitlist);
        setIdentityMode(s.comment_identity_mode);
        setLoaded(true);
      })
      .catch((err: Error) => {
        setError(`Could not load settings: ${err.message}`);
      });
  }, []);

  async function saveRecipients() {
    setSavingRecipients(true);
    setRecipientsMessage(null);
    try {
      const input = recipientsText
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const saved = await adminPatchSettings({ brief_recipient_emails: input });
      setRecipientsText(saved.brief_recipient_emails.join(", "));
      setRecipientsMessage(
        saved.brief_recipient_emails.length === 0
          ? "Cleared — brief approvals will be blocked until a recipient is set."
          : `Saved. Briefs will be delivered to ${saved.brief_recipient_emails.length} recipient(s).`,
      );
    } catch (err) {
      setRecipientsMessage(
        err instanceof Error ? err.message : "Failed to save recipients",
      );
    } finally {
      setSavingRecipients(false);
    }
  }

  function updateOfficial(i: number, patch: Partial<Official>) {
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
      },
    ]);
  }

  function removeOfficial(i: number) {
    setOfficials((cur) => cur.filter((_, idx) => idx !== i));
  }

  async function saveThreshold() {
    setSavingThreshold(true);
    setThresholdMessage(null);
    try {
      const saved = await adminPatchSettings({ support_threshold: threshold });
      setThreshold(saved.support_threshold);
      setThresholdMessage(
        saved.support_threshold === 0
          ? "Saved. New votes skip the support phase and open for ballots as soon as they are approved."
          : `Saved. New votes need ${saved.support_threshold} endorsement${saved.support_threshold !== 1 ? "s" : ""} to open for ballots.`,
      );
    } catch (err) {
      setThresholdMessage(
        err instanceof Error ? err.message : "Failed to save threshold",
      );
    } finally {
      setSavingThreshold(false);
    }
  }

  async function saveAllowlist() {
    setSavingAllowlist(true);
    setAllowlistMessage(null);
    try {
      const input = allowlistText
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const saved = await adminPatchSettings({ beta_allowlist: input });
      setAllowlistText(saved.beta_allowlist.join(", "));
      setAllowlistMessage(
        saved.beta_allowlist.length === 0
          ? "Cleared — no one can sign in during beta (except admins)."
          : `Saved. ${saved.beta_allowlist.length} email(s) on the allowlist.`,
      );
    } catch (err) {
      setAllowlistMessage(
        err instanceof Error ? err.message : "Failed to save allowlist",
      );
    } finally {
      setSavingAllowlist(false);
    }
  }

  async function saveIdentityMode() {
    setSavingIdentityMode(true);
    setIdentityModeMessage(null);
    try {
      const saved = await adminPatchSettings({ comment_identity_mode: identityMode });
      setIdentityMode(saved.comment_identity_mode);
      setIdentityModeMessage("Saved. Applies to new comments immediately.");
    } catch (err) {
      setIdentityModeMessage(
        err instanceof Error ? err.message : "Failed to save comment identity mode",
      );
    } finally {
      setSavingIdentityMode(false);
    }
  }

  function copyWaitlistEmails() {
    const emails = waitlist.map((w) => w.email).join(", ");
    navigator.clipboard.writeText(emails).then(() => {
      setCopiedWaitlist(true);
      setTimeout(() => setCopiedWaitlist(false), 2000);
    });
  }

  async function saveOfficials() {
    setSavingOfficials(true);
    setOfficialsMessage(null);
    try {
      const cleaned: Official[] = [];
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
      }
      const saved = await adminPatchSettings({ officials: cleaned });
      setOfficials(saved.officials);
      setOfficialsMessage(
        saved.officials.length === 0
          ? "Cleared — only admins can post announcements."
          : `Saved. ${saved.officials.length} official(s) can post announcements.`,
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
    <div className="page admin-settings-page">
      <AdminTabs />
      <div className="admin-settings-body">
        <h1>Settings</h1>
        <p className="admin-subtitle">
          Hub-wide configuration. Changes take effect immediately — no redeploy required.
        </p>

        {error && <p className="form-error">{error}</p>}

        {/* --- Brief recipients --- */}
        <section className="admin-settings-panel">
          <h3>Brief recipients</h3>
          <label className="form-label" htmlFor="brief-recipients">
            Brief recipient emails
          </label>
          <p className="form-hint">
            Comma- or newline-separated list of addresses that receive the brief
            on approval. Changes take effect on the next approval.
          </p>
          <textarea
            id="brief-recipients"
            className="form-textarea"
            rows={2}
            value={recipientsText}
            onChange={(e) => setRecipientsText(e.target.value)}
            disabled={!loaded || savingRecipients}
            placeholder="board@floyd.gov, clerk@floyd.gov"
          />
          <div className="admin-settings-actions">
            <button
              type="button"
              className="admin-convert-button"
              onClick={saveRecipients}
              disabled={!loaded || savingRecipients}
            >
              {savingRecipients ? "Saving…" : "Save recipients"}
            </button>
            {recipientsMessage && (
              <span className="admin-settings-message">{recipientsMessage}</span>
            )}
          </div>
        </section>

        {/* --- Officials --- */}
        <section className="admin-settings-panel">
          <h3>Officials</h3>
          <p className="form-hint">
            Accounts that hold a public office. The title shows as a pill next
            to their name everywhere they post — announcements, proposals,
            projects, and comments — and they can post announcements. Leave
            name blank to use the person's own account name. Admins can always
            post and only need to be listed here if they also hold an office
            (they will show both badges).
          </p>

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
                placeholder="Board of Supervisors"
                aria-label={`Official ${i + 1} title`}
                disabled={!loaded || savingOfficials}
                maxLength={50}
              />
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

          <div className="admin-settings-actions" style={{ marginTop: "var(--space-md)" }}>
            <button
              type="button"
              className="admin-convert-button"
              onClick={saveOfficials}
              disabled={!loaded || savingOfficials}
            >
              {savingOfficials ? "Saving…" : "Save officials"}
            </button>
            {officialsMessage && (
              <span className="admin-settings-message">{officialsMessage}</span>
            )}
          </div>
        </section>

        {/* --- Support threshold --- */}
        <section className="admin-settings-panel">
          <h3>Proposal endorsement threshold</h3>
          <label className="form-label" htmlFor="support-threshold">
            Endorsements needed
          </label>
          <p className="form-hint">
            How many community endorsements a proposed vote needs before it
            opens for ballots. Set it to 0 to skip the support phase: approved
            votes open immediately, with admin review as the only gate.
            Applies to votes submitted from now on — votes already gathering
            support keep their original number.
          </p>
          <input
            id="support-threshold"
            className="form-input"
            type="number"
            min={0}
            max={100}
            value={threshold}
            onChange={(e) => setThreshold(Math.max(0, parseInt(e.target.value) || 0))}
            disabled={!loaded || savingThreshold}
            style={{ maxWidth: "120px" }}
          />
          <div className="admin-settings-actions">
            <button
              type="button"
              className="admin-convert-button"
              onClick={saveThreshold}
              disabled={!loaded || savingThreshold}
            >
              {savingThreshold ? "Saving…" : "Save threshold"}
            </button>
            {thresholdMessage && (
              <span className="admin-settings-message">{thresholdMessage}</span>
            )}
          </div>
        </section>

        {/* --- Identity & anonymity --- */}
        <section className="admin-settings-panel">
          <h3>Identity &amp; anonymity</h3>
          <p className="form-hint">
            Votes are always anonymous (ballot secrecy) and creating a
            process always carries the creator's real name — those are
            fixed. This setting controls how residents appear on
            community comments.
          </p>
          <label className="form-label" htmlFor="comment-identity-mode">
            Comment identity
          </label>
          <select
            id="comment-identity-mode"
            className="form-input"
            value={identityMode}
            onChange={(e) => setIdentityMode(e.target.value as CommentIdentityMode)}
            disabled={!loaded || savingIdentityMode}
            style={{ maxWidth: "360px" }}
          >
            <option value="real_name">
              Real name required — no anonymous comments
            </option>
            <option value="anonymous_optional">
              Real name by default — residents may opt into anonymity
            </option>
            <option value="anonymous_only">
              Anonymous only — no names shown on comments
            </option>
          </select>
          <p className="form-hint">
            Anonymity is display-level: the author is always recorded
            internally for Code of Conduct moderation.
          </p>
          <div className="admin-settings-actions">
            <button
              type="button"
              className="admin-convert-button"
              onClick={saveIdentityMode}
              disabled={!loaded || savingIdentityMode}
            >
              {savingIdentityMode ? "Saving…" : "Save comment identity"}
            </button>
            {identityModeMessage && (
              <span className="admin-settings-message">{identityModeMessage}</span>
            )}
          </div>
        </section>

        {/* --- Beta allowlist --- */}
        <section className="admin-settings-panel">
          <h3>Beta allowlist</h3>
          <label className="form-label" htmlFor="beta-allowlist">
            Allowed emails
          </label>
          <p className="form-hint">
            Comma- or newline-separated list of emails allowed to sign in
            during beta. Admin emails are always allowed regardless of this
            list. Only takes effect when CIVIC_BETA_MODE is enabled.
          </p>
          <textarea
            id="beta-allowlist"
            className="form-textarea"
            rows={3}
            value={allowlistText}
            onChange={(e) => setAllowlistText(e.target.value)}
            disabled={!loaded || savingAllowlist}
            placeholder="friend@example.com, tester@example.com"
          />
          <div className="admin-settings-actions">
            <button
              type="button"
              className="admin-convert-button"
              onClick={saveAllowlist}
              disabled={!loaded || savingAllowlist}
            >
              {savingAllowlist ? "Saving…" : "Save allowlist"}
            </button>
            {allowlistMessage && (
              <span className="admin-settings-message">{allowlistMessage}</span>
            )}
          </div>
        </section>

        {/* --- Waitlist --- */}
        <section className="admin-settings-panel">
          <h3>Waitlist</h3>
          <p className="form-hint">
            People who signed up for access on the beta landing page.
          </p>

          {waitlist.length === 0 ? (
            <p className="empty-state-inline" style={{ margin: "var(--space-sm) 0" }}>
              No one on the waitlist yet.
            </p>
          ) : (
            <>
              <p className="form-hint" style={{ margin: "0 0 var(--space-sm)" }}>
                {waitlist.length} {waitlist.length === 1 ? "person" : "people"} on the waitlist.
              </p>
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
                <button
                  type="button"
                  className="admin-convert-button"
                  onClick={copyWaitlistEmails}
                  disabled={waitlist.length === 0}
                >
                  {copiedWaitlist ? "Copied!" : "Copy all emails"}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
