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

  // --- Officials & brief recipients ---
  // One section (Adam, 2026-09-06): the officials ARE the default brief
  // recipients. Each row carries a "sends briefs" flag; the hub-wide
  // recipient list is derived on save as the flagged officials plus any
  // standing addresses without an account (a clerk, a shared inbox). The
  // review page still lets the admin adjust the list per brief.
  type OfficialRow = Official & { sends_briefs: boolean };
  const [officials, setOfficials] = useState<OfficialRow[]>([]);
  const [extraRecipientsText, setExtraRecipientsText] = useState("");
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
        const recipients = new Set(s.brief_recipient_emails.map((e) => e.toLowerCase()));
        const officialEmails = new Set(s.officials.map((o) => o.email.toLowerCase()));
        setOfficials(
          s.officials.map((o) => ({ ...o, sends_briefs: recipients.has(o.email.toLowerCase()) })),
        );
        setExtraRecipientsText(
          s.brief_recipient_emails.filter((e) => !officialEmails.has(e.toLowerCase())).join(", "),
        );
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
      const saved = await adminPatchSettings({
        officials: cleaned,
        brief_recipient_emails: [...recipientEmails, ...extras],
      });
      const recipients = new Set(saved.brief_recipient_emails.map((e) => e.toLowerCase()));
      const officialEmails = new Set(saved.officials.map((o) => o.email.toLowerCase()));
      setOfficials(
        saved.officials.map((o) => ({ ...o, sends_briefs: recipients.has(o.email.toLowerCase()) })),
      );
      setExtraRecipientsText(
        saved.brief_recipient_emails.filter((e) => !officialEmails.has(e.toLowerCase())).join(", "),
      );
      const n = saved.brief_recipient_emails.length;
      setOfficialsMessage(
        `Saved. ${saved.officials.length} official(s); briefs go to ${n} recipient${n === 1 ? "" : "s"} by default.`,
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

        {/* --- Officials & brief recipients --- */}
        <section className="admin-settings-panel">
          <h3>Officials &amp; brief recipients</h3>
          <p className="form-hint">
            Accounts that hold a public office. The title shows as a pill next
            to their name everywhere they post — announcements, proposals,
            projects, and comments — and they can post announcements and
            respond to briefs. Leave name blank to use the person's own
            account name. Admins can always post and only need to be listed
            here if they also hold an office (they will show both badges).
          </p>
          <p className="form-hint">
            Officials marked <strong>Sends briefs</strong> receive every
            published brief by email. You can add or remove recipients for a
            particular brief while reviewing it.
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
              <span className="official-col-label">Sends briefs</span>
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
              <label className="official-sends-briefs">
                <input
                  type="checkbox"
                  checked={official.sends_briefs}
                  onChange={(e) => updateOfficial(i, { sends_briefs: e.target.checked })}
                  aria-label={`Official ${i + 1} receives briefs`}
                  disabled={!loaded || savingOfficials}
                />
                <span className="official-sends-briefs-text">Sends briefs</span>
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
              placeholder="clerk@floyd.gov, board@floyd.gov"
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
