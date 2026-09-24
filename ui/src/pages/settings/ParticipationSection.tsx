// Participation — the proposal endorsement threshold and how residents
// appear on comments. Two sub-blocks, each with its own Save button.

import { useEffect, useState } from "react";
import {
  adminGetSettings,
  adminPatchSettings,
  type CommentIdentityMode,
} from "../../services/api";
import { useHubSettings, useUnsavedChangesGuard } from "./HubSettingsContext";

export default function ParticipationSection() {
  const { setDirty } = useHubSettings();

  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Support threshold ---
  const [threshold, setThreshold] = useState(5);
  const [savedThreshold, setSavedThreshold] = useState(5);
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [thresholdMessage, setThresholdMessage] = useState<string | null>(null);

  // --- Comment identity ---
  const [identityMode, setIdentityMode] =
    useState<CommentIdentityMode>("anonymous_optional");
  const [savedIdentityMode, setSavedIdentityMode] =
    useState<CommentIdentityMode>("anonymous_optional");
  const [savingIdentityMode, setSavingIdentityMode] = useState(false);
  const [identityModeMessage, setIdentityModeMessage] = useState<string | null>(null);

  useEffect(() => {
    adminGetSettings()
      .then((s) => {
        setThreshold(s.support_threshold);
        setSavedThreshold(s.support_threshold);
        setIdentityMode(s.comment_identity_mode);
        setSavedIdentityMode(s.comment_identity_mode);
        setLoaded(true);
      })
      .catch((err: Error) => {
        setError(`Could not load settings: ${err.message}`);
      });
  }, []);

  const thresholdDirty = loaded && threshold !== savedThreshold;
  const identityModeDirty = loaded && identityMode !== savedIdentityMode;
  const dirty = thresholdDirty || identityModeDirty;
  useEffect(() => setDirty("participation", dirty), [dirty, setDirty]);
  useEffect(() => () => setDirty("participation", false), [setDirty]);
  useUnsavedChangesGuard(dirty);

  async function saveThreshold() {
    setSavingThreshold(true);
    setThresholdMessage(null);
    try {
      const saved = await adminPatchSettings({ support_threshold: threshold });
      setThreshold(saved.support_threshold);
      setSavedThreshold(saved.support_threshold);
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

  async function saveIdentityMode() {
    setSavingIdentityMode(true);
    setIdentityModeMessage(null);
    try {
      const saved = await adminPatchSettings({ comment_identity_mode: identityMode });
      setIdentityMode(saved.comment_identity_mode);
      setSavedIdentityMode(saved.comment_identity_mode);
      setIdentityModeMessage("Saved. Applies to new comments immediately.");
    } catch (err) {
      setIdentityModeMessage(
        err instanceof Error ? err.message : "Failed to save comment identity mode",
      );
    } finally {
      setSavingIdentityMode(false);
    }
  }

  return (
    <>
      <section className="settings-section">
        <h2 className="settings-section-title">Participation</h2>

        {error && <p className="form-error">{error}</p>}

        <h3 className="settings-subsection-title">Proposal endorsement threshold</h3>
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

      <section className="settings-section settings-section--follow">
        <h3 className="settings-subsection-title">Comments & anonymity</h3>
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
    </>
  );
}
