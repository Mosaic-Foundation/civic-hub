import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { Link } from "react-router-dom";
import PatternAvatar from "./PatternAvatar";
import SharePanel from "./SharePanel";
import { useAuth } from "../context/AuthContext";
import { membersPageShown } from "../config/navigation";
import { pluginEnabled } from "../config/plugins";
import { getMemberSummary, type MemberSummary } from "../services/api";
import "./MemberStack.css";

/**
 * "N members" with a small stack of pattern-avatars, on the home page, for
 * everyone (members and invites slice, Adam's design 2026-10-10). The count
 * includes members who hid themselves; the stack never shows them.
 *
 * Signed in, the count links to the Members page and "Share this hub" opens
 * the share panel.
 *
 * The count and stack are the Members plugin's (2026-10-14): gone while it is
 * off, and below its threshold residents get no number from the server, so
 * none is drawn. An admin sees the number then, with a note that residents
 * don't yet. "Share this hub" is the hub's own and stays either way.
 */
export default function MemberStack() {
  const { user, isAdmin } = useAuth();
  const [sharing, setSharing] = useState(false);

  const membersOn = pluginEnabled("members");
  // The count is a nicety: a failed read leaves the row out. A sign-in or out
  // reads it again, keeping the row shown.
  const { data: summary } = useApi<MemberSummary>(membersOn ? "members/summary" : null, () => getMemberSummary(), {
    rereadOn: user?.id,
  });

  const joined = !!user?.is_resident;
  const count = membersOn ? (summary?.count ?? null) : null;
  const showCount = count !== null && count > 0;
  if (!showCount && !joined) return null;

  const label = showCount ? `${count.toLocaleString()} ${count === 1 ? "member" : "members"}` : "";
  // Before the threshold an admin sees the number; residents see nothing.
  const adminOnly = showCount && summary?.shown === false;

  return (
    <div className="member-stack-row">
      {showCount && (
        <div className="member-stack" data-testid="member-stack">
          {summary!.stack.length > 0 && (
            <span className="member-stack-avatars" aria-hidden="true">
              {summary!.stack.map((seed) => (
                <PatternAvatar key={seed} seed={seed} size={28} />
              ))}
            </span>
          )}
          {joined && membersPageShown(isAdmin) ? (
            <Link to="/members" className="member-stack-count">
              {label}
            </Link>
          ) : (
            <span className="member-stack-count">{label}</span>
          )}
        </div>
      )}
      {adminOnly && (
        <p className="member-stack-note" data-testid="member-count-admin-only">
          Only admins see this until {(summary!.threshold ?? 0).toLocaleString()} members.{" "}
          <Link to="/admin/settings/plugins#members">Members plugin</Link>
        </p>
      )}
      {joined && (
        <button type="button" className="member-share-btn" onClick={() => setSharing(true)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" y1="8" x2="19" y2="14" />
            <line x1="22" y1="11" x2="16" y2="11" />
          </svg>
          Share this hub
        </button>
      )}
      {sharing && <SharePanel onClose={() => setSharing(false)} />}
    </div>
  );
}
