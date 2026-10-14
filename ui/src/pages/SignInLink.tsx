import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AuthModal, { officialFrom, type PendingAuth } from "../components/AuthModal";
import { rememberKeepSignedIn, rememberedKeepSignedIn, verifyInvite, verifyLink } from "../services/auth";
import hub from "../config/hub";

/**
 * Where the code email's "Sign in" link lands (sign-in slice, Adam
 * 2026-10-13): /sign-in#t=<token>. The token is after `#`, so it never
 * reaches a server log; it is taken out of the address bar at once.
 *
 * Nothing happens until the person presses Confirm: mail scanners open links
 * in emails, and a link that signed in on opening would be spent by them.
 * The token is the same code as the six digits, checked by the same rules.
 */
interface LinkToken {
  /** A code's "Sign in" link (#t=), or a member's invite (#invite=, members and invites slice). */
  kind: "code" | "invite";
  value: string;
}

function takeLinkToken(): LinkToken | null {
  const match = /^#(t|invite)=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
  if (!match) return null;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return { kind: match[1] === "invite" ? "invite" : "code", value: match[2]! };
}

export default function SignInLink() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [token, setToken] = useState(takeLinkToken);
  const [keepSignedIn, setKeepSignedIn] = useState(rememberedKeepSignedIn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A new member still joins: the modal opens at its join step.
  const [pending, setPending] = useState<PendingAuth | null>(null);

  // A second link opened while this page is showing changes only the hash.
  useEffect(() => {
    const onHash = () => {
      const next = takeLinkToken();
      if (next) {
        setToken(next);
        setError(null);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Already signed in (a second tap on an old link): nothing to confirm.
  useEffect(() => {
    if (user && !pending && !busy) navigate("/", { replace: true });
  }, [user, pending, busy, navigate]);

  async function confirm() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      rememberKeepSignedIn(keepSignedIn);
      const result =
        token.kind === "invite" ? await verifyInvite(token.value, keepSignedIn) : await verifyLink(token.value, keepSignedIn);
      if (result.user.is_resident && result.user.full_name) {
        login(result.token, result.user, result.role, result.author_label, officialFrom(result));
        navigate("/", { replace: true });
      } else {
        setPending({
          token: result.token,
          user: result.user,
          role: result.role,
          author_label: result.author_label,
          official: officialFrom(result),
        });
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : token.kind === "invite"
            ? "This invite link didn't work. You can still sign in with your email address."
            : "This sign-in link didn't work. Ask for a new code.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="page sign-in-link-page">
      <div className="sign-in-link-card">
        <h1 className="auth-title">{token?.kind === "invite" ? `Join ${hub.name}` : `Sign in to ${hub.name}`}</h1>
        {token ? (
          <>
            <p className="auth-description">
              {token.kind === "invite"
                ? "You opened the invite from your email. Press Confirm to come in, then add your name to join."
                : "You opened the sign-in link from your email. Press Confirm to sign in."}
            </p>
            <label className="auth-checkbox-label auth-keep-signed-in">
              <input
                type="checkbox"
                checked={keepSignedIn}
                onChange={(e) => setKeepSignedIn(e.target.checked)}
                disabled={busy}
              />
              <span>Keep me signed in on this device</span>
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="button" className="auth-continue-button" onClick={confirm} disabled={busy || !!pending}>
              {busy ? "Signing in..." : "Confirm"}
            </button>
          </>
        ) : (
          <p className="auth-description">
            This sign-in link is incomplete. Open it again from the email, or sign in from the menu with a new code.
          </p>
        )}
      </div>
      {pending && (
        <AuthModal
          pending={pending}
          onComplete={() => navigate("/", { replace: true })}
          onDismiss={() => navigate("/", { replace: true })}
        />
      )}
    </article>
  );
}
