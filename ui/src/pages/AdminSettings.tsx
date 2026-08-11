// Admin settings page — hub-wide configuration.
//
// Holds all admin-editable settings that aren't tied to a single
// proposal or brief review flow. Today: brief recipient emails and the
// announcement authors list. Future additions (theme, jurisdiction,
// email templates, etc.) should land here too.

import { useEffect, useState } from "react";
import {
  adminGetSettings,
  adminPatchSettings,
  type AnnouncementAuthor,
  type WaitlistEntry,
  type CommentIdentityMode,
} from "../services/api";
import AdminTabs from "../components/AdminTabs";
import "./AdminSettings.css";

export default function AdminSettings() {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Brief recipients ---
  const [recipientsText, setRecipientsText] = useState("");
  const [savingRecipients, setSavingRecipients] = useState(false);
  const [recipientsMessage, setRecipientsMessage] = useState<string | null>(null);

  // --- Announcement authors ---
  const [authors, setAuthors] = useState<AnnouncementAuthor[]>([]);
  const [savingAuthors, setSavingAuthors] = useState(false);
  const [authorsMessage, setAuthorsMessage] = useState<string | null>(null);

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
        setAuthors(s.announcement_authors);
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

  function updateAuthor(i: number, patch: Partial<AnnouncementAuthor>) {
    setAuthors((cur) => cur.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }

  function addAuthor() {
    setAuthors((cur) => [...cur, { email: "", name: "", label: "Board member" }]);
  }

  function removeAuthor(i: number) {
    setAuthors((cur) => cur.filter((_, idx) => idx !== i));
  }

  async function saveThreshold() {
    setSavingThreshold(true);
    setThresholdMessage(null);
    try {
      const saved = await adminPatchSettings({ support_threshold: threshold });
      setThreshold(saved.support_threshold);
      setThresholdMessage(`Saved. New proposals need ${saved.support_threshold} endorsement${saved.support_threshold !== 1 ? "s" : ""} to become official votes.`);
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

  async function saveAuthors() {
    setSavingAuthors(true);
    setAuthorsMessage(null);
    try {
      const cleaned: AnnouncementAuthor[] = [];
      for (const a of authors) {
        const email = a.email.trim();
        const name = (a.name ?? "").trim();
        const label = a.label.trim();
        if (!email && !name && !label) continue;
        if (!email || !label) {
          throw new Error("Each author needs both an email and a role.");
        }
        cleaned.push(name ? { email, name, label } : { email, label });
      }
      const saved = await adminPatchSettings({ announcement_authors: cleaned });
      setAuthors(saved.announcement_authors);
      setAuthorsMessage(
        saved.announcement_authors.length === 0
          ? "Cleared — only admins can post announcements."
          : `Saved. ${saved.announcement_authors.length} non-admin author(s) can now post.`,
      );
    } catch (err) {
      setAuthorsMessage(
        err instanceof Error ? err.message : "Failed to save authors",
      );
    } finally {
      setSavingAuthors(false);
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

        {/* --- Brief delivery --- */}
        <section className="admin-settings-panel">
          <h3>Brief delivery</h3>
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

        {/* --- Announcement authors --- */}
        <section className="admin-settings-panel">
          <h3>Announcement authors</h3>
          <p className="form-hint">
            Non-admin users who can post announcements. The name and role show
            on the public feed and announcement page as "Posted by [Name],
            [Role]". Leave name blank to use the author's own account name.
            Admins can always post (as "Admin") and don't need to be listed here.
          </p>

          {authors.length === 0 && (
            <p className="empty-state-inline" style={{ margin: "var(--space-sm) 0" }}>
              No non-admin authors configured. Only admins can post announcements.
            </p>
          )}

          {authors.length > 0 && (
            <div className="announcement-author-row announcement-author-head" aria-hidden="true">
              <span className="announcement-author-col-label">Email</span>
              <span className="announcement-author-col-label">Name</span>
              <span className="announcement-author-col-label">
                Role <span className="announcement-author-col-note">(public label)</span>
              </span>
              <span />
            </div>
          )}

          {authors.map((author, i) => (
            <div key={i} className="announcement-author-row">
              <input
                className="form-input"
                type="email"
                value={author.email}
                onChange={(e) => updateAuthor(i, { email: e.target.value })}
                placeholder="author@example.com"
                aria-label={`Author ${i + 1} email`}
                disabled={!loaded || savingAuthors}
              />
              <input
                className="form-input"
                type="text"
                value={author.name ?? ""}
                onChange={(e) => updateAuthor(i, { name: e.target.value })}
                placeholder="Linda DeVito"
                aria-label={`Author ${i + 1} name`}
                disabled={!loaded || savingAuthors}
                maxLength={80}
              />
              <input
                className="form-input"
                type="text"
                value={author.label}
                onChange={(e) => updateAuthor(i, { label: e.target.value })}
                placeholder="Board member"
                aria-label={`Author ${i + 1} role`}
                disabled={!loaded || savingAuthors}
                maxLength={50}
              />
              <button
                type="button"
                className="admin-remove-section"
                onClick={() => removeAuthor(i)}
                disabled={savingAuthors}
                aria-label={`Remove author ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}

          <button
            type="button"
            className="admin-add-section"
            onClick={addAuthor}
            disabled={!loaded || savingAuthors}
          >
            + Add author
          </button>

          <div className="admin-settings-actions" style={{ marginTop: "var(--space-md)" }}>
            <button
              type="button"
              className="admin-convert-button"
              onClick={saveAuthors}
              disabled={!loaded || savingAuthors}
            >
              {savingAuthors ? "Saving…" : "Save authors"}
            </button>
            {authorsMessage && (
              <span className="admin-settings-message">{authorsMessage}</span>
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
            becomes an official vote. Applies to new proposals — existing ones
            keep their original threshold.
          </p>
          <input
            id="support-threshold"
            className="form-input"
            type="number"
            min={1}
            max={100}
            value={threshold}
            onChange={(e) => setThreshold(Math.max(1, parseInt(e.target.value) || 1))}
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
                      <th>Email</th>
                      <th>Signed up</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waitlist.map((w) => (
                      <tr key={w.email}>
                        <td>{w.email}</td>
                        <td>{new Date(w.created_at).toLocaleDateString()}</td>
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
