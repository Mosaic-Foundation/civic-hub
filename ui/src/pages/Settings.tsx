// User settings page — minimum viable for Slice 5.
//
// Today: single panel for the daily digest toggle. Future preferences
// (theme, jurisdiction, email templates, etc.) should land here as
// additional panels. Authenticated users only — residents and
// admins alike see the same page.

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { setDigestFrequency } from "../services/api";
import hub from "../config/hub";
import {
  deleteAccount as deleteAccountApi,
  getMe,
  getStoredToken,
  setHideAiDraftingHelp,
} from "../services/auth";
import "./Settings.css";

export default function Settings() {
  const { user, logout, loading, updateUser } = useAuth();
  const navigate = useNavigate();
  // "loading" = haven't fetched yet, number = frequency in days, null = unsubscribed
  const [frequency, setFrequency] = useState<number | null | "loading">("loading");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // "Hide AI drafting help" — server-persisted so it follows the user
  // across devices. Initialized from the freshly fetched user below.
  const [hideDraftingHelp, setHideDraftingHelp] = useState(false);
  const [savingDraftingHelp, setSavingDraftingHelp] = useState(false);
  const [draftingHelpMessage, setDraftingHelpMessage] = useState<string | null>(null);
  const [draftingHelpError, setDraftingHelpError] = useState<string | null>(null);

  // Slice 13.11 — account deletion local state. The user types
  // their own email into the confirm input; submit is gated on an
  // exact match so accidental clicks can't go through.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Pull the current subscription state from the server on mount.
  // /auth/me returns the full User, which includes digest_frequency_days
  // after Slice 5. We refetch instead of trusting the cached context so
  // the toggle reflects any out-of-band changes (e.g. the user clicked
  // an unsubscribe link in another tab).
  useEffect(() => {
    if (loading) return;
    if (!user) return;
    const token = getStoredToken();
    if (!token) return;
    getMe(token)
      .then(({ user: u }) => {
        setFrequency(u.digest_frequency_days);
        setHideDraftingHelp(u.hide_ai_drafting_help === true);
      })
      .catch((err: Error) => {
        setError(`Could not load settings: ${err.message}`);
      });
  }, [loading, user]);

  async function onHideDraftingHelpChange(hide: boolean) {
    const token = getStoredToken();
    if (!token) return;
    setSavingDraftingHelp(true);
    setDraftingHelpMessage(null);
    setDraftingHelpError(null);
    try {
      const { user: updated } = await setHideAiDraftingHelp(token, hide);
      setHideDraftingHelp(updated.hide_ai_drafting_help);
      updateUser(updated);
      setDraftingHelpMessage(
        updated.hide_ai_drafting_help
          ? "Saved. You won't see the drafting assistant anywhere."
          : "Saved. The drafting assistant is available again (collapsed until you open it).",
      );
    } catch (err) {
      setDraftingHelpError(
        err instanceof Error ? err.message : "Could not save setting",
      );
    } finally {
      setSavingDraftingHelp(false);
    }
  }

  async function handleDeleteAccount() {
    if (!user) return;
    const token = getStoredToken();
    if (!token) {
      setDeleteError("Session expired. Sign in again before deleting.");
      return;
    }
    if (deleteConfirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
      setDeleteError("Email doesn't match your account.");
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccountApi(token);
      // Clear local session state and redirect home. The auth
      // context's logout() drops the token from localStorage and
      // resets user/role; navigating to "/" lands them on the
      // public feed.
      logout();
      navigate("/", { replace: true });
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Could not delete account",
      );
      setDeleting(false);
    }
  }

  const FREQUENCY_OPTIONS: { value: string; label: string }[] = [
    { value: "1", label: "Daily" },
    { value: "3", label: "Every 3 days" },
    { value: "7", label: "Weekly" },
    { value: "14", label: "Every 2 weeks" },
    { value: "30", label: "Monthly" },
    { value: "off", label: "Unsubscribed" },
  ];

  function frequencyLabel(days: number | null): string {
    if (days === null) return "Unsubscribed";
    const opt = FREQUENCY_OPTIONS.find((o) => o.value === String(days));
    return opt ? opt.label : `Every ${days} days`;
  }

  async function onFrequencyChange(value: string) {
    const next = value === "off" ? null : parseInt(value, 10);
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await setDigestFrequency(next);
      setFrequency(res.digest_frequency_days);
      setMessage(
        res.digest_frequency_days !== null
          ? `Saved. You'll receive a digest ${frequencyLabel(res.digest_frequency_days).toLowerCase()}.`
          : "Unsubscribed. You won't receive the digest.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save setting");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page settings-page">
        <p className="settings-status">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page settings-page">
        <h1>Settings</h1>
        <p className="settings-status">
          You need to be signed in to manage your settings.{" "}
          <Link to="/">Return to the feed</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="page settings-page">
      <div className="settings-body">
        <h1>Settings</h1>
        <p className="settings-subtitle">
          Manage how you hear from {hub.name}.
        </p>

        {error && <p className="form-error">{error}</p>}

        <section className="settings-panel">
          <h3>Email digest</h3>
          <p className="form-hint">
            We send a summary of new votes, published results, and
            announcements. If there's nothing new, we don't send anything.
            Choose how often you'd like to hear from us.
          </p>

          <label className="form-label" htmlFor="digest-frequency">
            Digest frequency
          </label>
          <select
            id="digest-frequency"
            className="form-select"
            value={
              frequency === "loading"
                ? ""
                : frequency === null
                  ? "off"
                  : String(frequency)
            }
            onChange={(e) => onFrequencyChange(e.target.value)}
            disabled={frequency === "loading" || saving}
          >
            {frequency === "loading" && (
              <option value="" disabled>
                Loading...
              </option>
            )}
            {FREQUENCY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {message && <p className="settings-message">{message}</p>}
        </section>

        <section className="settings-panel">
          <h3>AI drafting help</h3>
          <p className="form-hint">
            When you create a proposal, vote, or project, an optional AI
            assistant can help you draft. It never opens on its own — but if
            you'd rather not see it at all, hide it here. This applies on
            every device you sign in from. Every submission still gets the
            automated Code of Conduct check either way.
          </p>

          <label className="settings-toggle-row">
            <input
              type="checkbox"
              checked={hideDraftingHelp}
              onChange={(e) => onHideDraftingHelpChange(e.target.checked)}
              disabled={savingDraftingHelp}
            />
            <span>Hide AI drafting help</span>
          </label>

          {draftingHelpMessage && (
            <p className="settings-message">{draftingHelpMessage}</p>
          )}
          {draftingHelpError && <p className="form-error">{draftingHelpError}</p>}
        </section>

        <p className="settings-signed-in">
          Signed in as <strong>{user.email}</strong>.
        </p>

        {/* Slice 13.11 — danger zone: self-service account deletion.
            Frees the email for re-use, removes the user record,
            cascades sessions. Public-record references (comments,
            endorsements, vote participation) become orphaned (no
            attribution) — vote tallies are unaffected because
            vote_records have no user_id by design. */}
        <section className="settings-panel settings-danger-zone">
          <h3>Delete account</h3>
          <p className="form-hint">
            Permanently delete your account. Your votes stay counted but
            will no longer be linked to your identity. Comments and
            endorsements you posted will remain in the public record but
            without your name attached. This cannot be undone.
          </p>

          {!deleteOpen && (
            <button
              type="button"
              className="settings-danger-button"
              onClick={() => {
                setDeleteOpen(true);
                setDeleteConfirmEmail("");
                setDeleteError(null);
              }}
            >
              Delete my account
            </button>
          )}

          {deleteOpen && (
            <div className="settings-danger-confirm">
              <p>
                Type your email <strong>{user.email}</strong> below to confirm.
              </p>
              <input
                type="email"
                className="form-input"
                value={deleteConfirmEmail}
                onChange={(e) => setDeleteConfirmEmail(e.target.value)}
                placeholder={user.email}
                disabled={deleting}
                autoFocus
              />
              {deleteError && <p className="form-error">{deleteError}</p>}
              <div className="settings-danger-actions">
                <button
                  type="button"
                  className="settings-danger-button"
                  onClick={handleDeleteAccount}
                  disabled={
                    deleting ||
                    deleteConfirmEmail.trim().toLowerCase() !==
                      user.email.toLowerCase()
                  }
                >
                  {deleting ? "Deleting…" : "Permanently delete"}
                </button>
                <button
                  type="button"
                  className="settings-danger-cancel"
                  onClick={() => {
                    setDeleteOpen(false);
                    setDeleteConfirmEmail("");
                    setDeleteError(null);
                  }}
                  disabled={deleting}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
