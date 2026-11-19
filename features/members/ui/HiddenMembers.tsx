import HelpButton from "../../../ui/src/components/HelpButton";
import PatternAvatar from "../../../ui/src/components/PatternAvatar";
import { useApi } from "../../../ui/src/hooks/useApi";
import { adminGetHiddenMembers } from "./api";
import "./Members.css";

/**
 * Admin → Settings → People: the members who hid themselves from the Members page and the home page's
 * stack (members and invites slice). Admins are the only people who see
 * them, here; still no addresses.
 */
export default function HiddenMembers() {
  const { data, error: loadError } = useApi("admin/hidden-members", () => adminGetHiddenMembers());
  const error = loadError ? `Could not load the members: ${loadError.message}` : null;
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
