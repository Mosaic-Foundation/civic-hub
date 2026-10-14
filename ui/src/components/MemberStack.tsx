import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PatternAvatar from "./PatternAvatar";
import SharePanel from "./SharePanel";
import { useAuth } from "../context/AuthContext";
import { getMemberSummary, type MemberSummary } from "../services/api";
import "./MemberStack.css";

/**
 * "N members" with a small stack of pattern-avatars, on the home page, for
 * everyone (members and invites slice, Adam's design 2026-10-10). The count
 * includes members who hid themselves; the stack never shows them.
 *
 * Signed in, the count links to the Members page and "Share this hub" opens
 * the share panel.
 */
export default function MemberStack() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<MemberSummary | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let live = true;
    getMemberSummary()
      .then((s) => live && setSummary(s))
      .catch(() => {
        // The count is a nicety: a failed read leaves the row out.
      });
    return () => {
      live = false;
    };
  }, [user?.id]);

  if (!summary || summary.count === 0) return null;

  const label = `${summary.count.toLocaleString()} ${summary.count === 1 ? "member" : "members"}`;
  const joined = !!user?.is_resident;

  return (
    <div className="member-stack-row">
      <div className="member-stack" data-testid="member-stack">
        {summary.stack.length > 0 && (
          <span className="member-stack-avatars" aria-hidden="true">
            {summary.stack.map((seed) => (
              <PatternAvatar key={seed} seed={seed} size={28} />
            ))}
          </span>
        )}
        {joined ? (
          <Link to="/members" className="member-stack-count">
            {label}
          </Link>
        ) : (
          <span className="member-stack-count">{label}</span>
        )}
      </div>
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
