import { useState } from "react";
import { useAuth } from "../../../ui/src/context/authState";
import { useHub } from "../../../ui/src/config/hub";
import { setHiddenFromMembers } from "../../../ui/src/services/auth";
import { getStoredToken } from "../../../ui/src/services/tokenStore";
import HelpButton from "../../../ui/src/components/HelpButton";

/**
 * A person's own switch, in their Settings (members and invites slice): left
 * off the Members page and Home's faces, still counted. The switch itself is
 * the kernel's (PATCH /auth/me `hidden_from_members`); this panel is here
 * while the Members plugin is on, since there is no page to hide from
 * otherwise.
 */
export default function AccountPanel() {
  const hub = useHub();
  const { user, updateUser } = useAuth();
  const [hidden, setHidden] = useState(user?.hidden_from_members === true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onChange(show: boolean) {
    const token = getStoredToken();
    if (!token) return;
    // At once, so the box doesn't snap back while the save is on its way.
    setHidden(!show);
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const { user: updated } = await setHiddenFromMembers(token, !show);
      setHidden(updated.hidden_from_members === true);
      updateUser(updated);
      setMessage(
        updated.hidden_from_members
          ? "Saved. You're off the Members page and the home page. You're still counted, and admins can see you."
          : "Saved. Other members can see your name on the Members page.",
      );
    } catch (err) {
      setHidden(show);
      setError(err instanceof Error ? err.message : "Could not save setting");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-panel" id="members" data-anchor="">
      <h3 className="settings-panel-heading">
        Members page
        <HelpButton k="members.visibility" label="Members page" />
      </h3>
      <p className="form-hint">
        Members of {hub.name} can see each other's names and a pattern
        picture on the Members page, and the home page shows a few of the
        pictures. Never your email address. Turn this off to be left out of
        both; you're still counted as a member.
      </p>
      <label className="settings-toggle-row">
        <input type="checkbox" checked={!hidden} onChange={(e) => onChange(e.target.checked)} disabled={saving} />
        <span>Show me on the Members page</span>
      </label>
      {message && <p className="settings-message">{message}</p>}
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
