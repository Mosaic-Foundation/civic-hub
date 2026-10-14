import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AuthModal from "../components/AuthModal";
import PatternAvatar from "../components/PatternAvatar";
import SharePanel from "../components/SharePanel";
import { getMembers, type Member } from "../services/api";
import "./Members.css";

/**
 * The Members page (members and invites slice, Adam's design 2026-10-10):
 * for signed-in members only. Each member's pattern-avatar and name, admins
 * marked, no addresses. People who hid themselves aren't here, but the count
 * includes them, as on the home page.
 */
export default function Members() {
  const { user, loading } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [youAreHidden, setYouAreHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [sharing, setSharing] = useState(false);

  async function load(offset: number) {
    setBusy(true);
    setError(null);
    try {
      const page = await getMembers(offset);
      setMembers((prev) => (offset === 0 ? page.members : [...prev, ...page.members]));
      setCount(page.count);
      setNext(page.next);
      setYouAreHidden(page.you_are_hidden);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the members.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (loading || !user?.is_resident) return;
    void load(0);
  }, [loading, user?.id, user?.is_resident]);

  if (loading) {
    return (
      <div className="page members-page">
        <p className="settings-status">Loading…</p>
      </div>
    );
  }

  if (!user || !user.is_resident) {
    return (
      <div className="page members-page">
        <h1>Members</h1>
        <p className="settings-status">Members can see who else is here. Sign in or join to see them.</p>
        <p>
          <button type="button" className="auth-continue-button" onClick={() => setShowAuth(true)}>
            {user ? "Join" : "Sign in"}
          </button>
        </p>
        {showAuth && <AuthModal onComplete={() => setShowAuth(false)} onDismiss={() => setShowAuth(false)} />}
      </div>
    );
  }

  const hiddenCount = count !== null ? count - members.length : 0;

  return (
    <div className="page members-page">
      <div className="members-header">
        <div>
          <h1>Members</h1>
          {count !== null && (
            <p className="members-count">
              {count.toLocaleString()} {count === 1 ? "member" : "members"}
            </p>
          )}
        </div>
        <button type="button" className="member-share-btn" onClick={() => setSharing(true)}>
          Share this hub
        </button>
      </div>

      {youAreHidden && (
        <p className="members-note" role="status">
          You're hidden from this page and the home page. <Link to="/settings#members">Change this in Settings</Link>.
        </p>
      )}

      {error && <p className="form-error">{error}</p>}

      <ul className="members-list" aria-label="Members">
        {members.map((m) => (
          <li key={m.avatar} className="members-item">
            <PatternAvatar seed={m.avatar} size={36} />
            <span className="members-name">{m.name}</span>
            {m.is_admin && <span className="members-admin">Admin</span>}
          </li>
        ))}
      </ul>

      {next !== null && (
        <p>
          <button type="button" className="members-more" onClick={() => load(next)} disabled={busy}>
            {busy ? "Loading…" : "Show more"}
          </button>
        </p>
      )}
      {next === null && hiddenCount > 0 && members.length > 0 && (
        <p className="members-note members-note--quiet">
          {hiddenCount === 1 ? "1 member prefers" : `${hiddenCount.toLocaleString()} members prefer`} not to be listed.
        </p>
      )}

      {sharing && <SharePanel onClose={() => setSharing(false)} />}
    </div>
  );
}
