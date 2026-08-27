import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import {
  requestCode,
  verifyCode,
  affirmResidency,
  updateFullName,
  acceptTos,
  type AuthRole,
  type AuthUser,
} from "../services/auth";
import { CURRENT_LEGAL_VERSION } from "../config/legal";
import hub from "../config/hub";
import WaitlistForm from "./WaitlistForm";

/**
 * Slice 13.10: deferred login() until the residency + legal gate
 * passes. Prevents users from ending up with a partial session if
 * they close the modal between code verification and the gate.
 */
interface PendingAuth {
  token: string;
  user: AuthUser;
  role: AuthRole;
  author_label: string | null;
  official: { type: string; title: string } | null;
}

/**
 * Collapse the verify response's two flat official_* fields into the
 * shape AuthContext holds. Both must be present — a type with no title
 * has nothing to render (the same both-or-neither rule the DB enforces).
 */
function officialFrom(result: {
  official_type: string | null;
  official_title: string | null;
}): { type: string; title: string } | null {
  return result.official_type && result.official_title
    ? { type: result.official_type, title: result.official_title }
    : null;
}

type Step = "email" | "code" | "residency";

interface Props {
  /** Called when the full auth flow is complete (verified + resident) */
  onComplete: () => void;
  /** Called when the user dismisses the modal */
  onDismiss: () => void;
}

export default function AuthModal({ onComplete, onDismiss }: Props) {
  const { user, token, login, updateUser } = useAuth();
  const [step, setStep] = useState<Step>(() => {
    // Any verified user lands on the gate step — it renders only the
    // pieces they're missing (residency checkbox and/or name field),
    // and auto-completes when nothing is missing.
    if (user && user.email_verified) return "residency";
    return "email";
  });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  // Required-name policy: collected at the gate for new users, and for
  // returning accounts that pre-date the policy (re-gate).
  const [fullName, setFullName] = useState("");
  // Slice 13.10 — verifyCode result is held here UNTIL the residency
  // gate passes. We do not call login() at the verify step anymore so
  // dismissing the modal at the gate leaves no session behind.
  const [pendingAuth, setPendingAuth] = useState<PendingAuth | null>(null);
  // Slice 13.9 — single combined gate checkbox for new users: residency
  // affirmation + legal-doc acceptance in one click. Returning residents
  // (is_resident=true) skip this step entirely. The app-root
  // ReAcceptModal still catches returning users whose tos_version is
  // stale, so this single gate is sufficient at sign-up.
  const [gateChecked, setGateChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set when the backend rejects the email because the hub is in private
  // beta and the address isn't on the allow-list. Instead of a dead-end
  // error we swap the email form for a waitlist capture.
  const [betaBlocked, setBetaBlocked] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // If user is already fully authenticated + resident + named, just complete
  useEffect(() => {
    if (user && user.email_verified && user.is_resident && user.full_name) {
      onComplete();
    }
  }, [user, onComplete]);

  // Focus management
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onDismiss]);

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }

    setLoading(true);
    try {
      await requestCode(email.trim());
      setStep("code");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to send code";
      // The beta allow-list gate rejects unknown emails at the request-code
      // step (civic.auth requestVerification). Turn that into a waitlist
      // invitation rather than a red error the visitor can't act on.
      if (/private beta/i.test(message)) {
        setBetaBlocked(true);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResendCode() {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await requestCode(email.trim());
      setCode("");
      setNotice("A new code has been sent to your email.");
    } catch (err) {
      // Backend enforces a 30s resend throttle and the lockout window; surface
      // whatever message it returns ("Please wait…", "Too many attempts…").
      setError(err instanceof Error ? err.message : "Failed to resend code");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!code.trim()) {
      setError("Please enter the verification code");
      return;
    }

    setLoading(true);
    try {
      const result = await verifyCode(email.trim(), code.trim());

      if (result.user.is_resident && result.user.full_name) {
        // Returning resident with a name on file — fully signed up
        // before. login() now, complete. The app-root ReAcceptModal
        // catches them if their legal-version is stale.
        login(
          result.token,
          result.user,
          result.role,
          result.author_label,
          officialFrom(result),
        );
        onComplete();
      } else {
        // New user, or a returning account missing the (now required)
        // real name — hold the credentials in local state and route to
        // the gate, which renders only the missing pieces. login()
        // fires once the gate passes; closing the modal here leaves no
        // session behind.
        setPendingAuth({
          token: result.token,
          user: result.user,
          role: result.role,
          author_label: result.author_label,
          official: officialFrom(result),
        });
        setStep("residency");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  // The gate renders only what the (pending or current) user is
  // missing: the residency+legal checkbox, the real-name field, or both.
  const gateUser = pendingAuth?.user ?? user;
  const needsResidency = !gateUser?.is_resident;
  const needsName = !gateUser?.full_name;

  async function handleResidency(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (needsName && fullName.trim().length < 2) {
      setError("Please enter your full name.");
      return;
    }
    if (needsResidency && !gateChecked) {
      setError(
        "Please confirm your residency and acceptance of the policies to continue.",
      );
      return;
    }

    // Two paths into the residency step:
    //   1. Brand-new sign-up (or returning account missing the required
    //      name) — pendingAuth holds the verified-but-not-yet-logged-in
    //      credentials from handleVerifyCode. login() will fire only
    //      after the gate passes.
    //   2. Returning user already logged in (re-opened the modal
    //      because is_resident or full_name is still missing) —
    //      useAuth's token applies. updateUser() refreshes the cached
    //      state.
    const tokenToUse = pendingAuth?.token ?? token ?? null;
    if (!tokenToUse) {
      setError("Session expired. Please start over.");
      return;
    }

    setLoading(true);
    try {
      let nextUser: AuthUser;
      if (needsResidency) {
        // Combined gate: affirm residency (+ name) + record legal-doc
        // acceptance. Both calls happen here so a network blip on
        // either surfaces an error the user can retry on this same
        // step rather than getting half-completed sign-ups. acceptTos
        // failure is non-fatal — the re-acceptance modal will catch
        // them on next page load.
        const residencyResult = await affirmResidency(
          tokenToUse,
          needsName ? fullName.trim() : undefined,
        );
        nextUser = residencyResult.user;
        try {
          const accepted = await acceptTos(tokenToUse, CURRENT_LEGAL_VERSION);
          nextUser = accepted.user;
        } catch (acceptErr) {
          console.warn(
            "[auth] accept-tos failed during sign-up; re-acceptance modal will retry.",
            acceptErr,
          );
        }
      } else {
        // Already a resident — this is the required-name re-gate for an
        // account that pre-dates the policy. No ToS re-acceptance here
        // (the ReAcceptModal owns legal-version staleness).
        const updated = await updateFullName(tokenToUse, fullName.trim());
        nextUser = updated.user;
      }
      // Only NOW does the session actually start — login() fires with
      // the gate-passed user. If the user had closed the modal before
      // reaching this point, no login() ever happened.
      if (pendingAuth) {
        login(
          tokenToUse,
          nextUser,
          pendingAuth.role,
          pendingAuth.author_label,
          pendingAuth.official,
        );
        // First-time signup — route to the onboarding word cloud if configured.
        if (needsResidency) {
          const wcId = hub.onboarding_wordcloud_id;
          if (wcId) {
            window.location.href = `/wordcloud/${wcId}?onboarding=1`;
            return;
          }
        }
      } else {
        updateUser(nextUser);
      }
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm residency");
    } finally {
      setLoading(false);
    }
  }

  return (
    // Slice 13.9: clicking the overlay does NOT dismiss the modal.
    // Users must use the X close button (or Escape) so accidental
    // outside-clicks don't lose form state mid-sign-up. The modal
    // itself doesn't need stopPropagation now that the overlay has
    // no click handler.
    <div className="intro-overlay">
      <div
        className="intro-modal auth-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Create an account to participate"
      >
        <button
          ref={closeRef}
          className="intro-close"
          onClick={onDismiss}
          aria-label="Close"
        >
          &times;
        </button>

        {/* Private-beta fallback: the entered email isn't on the allow-list.
            Offer the waitlist instead of a dead-end error. */}
        {step === "email" && betaBlocked && (
          <div className="auth-beta-blocked">
            <h2 className="auth-title">We're in private beta</h2>
            <p className="auth-description">
              {hub.name} isn't open for general sign-ups yet. Join the waitlist
              and we'll email you the moment access opens up.
            </p>
            <WaitlistForm initialEmail={email} />
          </div>
        )}

        {/* Step 1: Email */}
        {step === "email" && !betaBlocked && (
          <form onSubmit={handleRequestCode}>
            <h2 className="auth-title">Create an account to participate</h2>
            <p className="auth-description">
              Enter your email to get started. We'll send you a verification code.
            </p>

            <div className="form-field">
              <label htmlFor="auth-email" className="form-label">Email</label>
              <input
                id="auth-email"
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus
                disabled={loading}
              />
            </div>

            {error && <p className="form-error">{error}</p>}

            <button
              type="submit"
              className="auth-continue-button"
              disabled={loading || !email.trim()}
            >
              {loading ? "Sending..." : "Continue"}
            </button>
          </form>
        )}

        {/* Step 2: Verify code */}
        {step === "code" && (
          <form onSubmit={handleVerifyCode}>
            <h2 className="auth-title">Check your email</h2>
            <p className="auth-description">
              We sent a 6-digit code to <strong>{email}</strong>
            </p>
            {hub.demo_mode && hub.demo_bypass_code && (
              <p className="auth-hint">
                Use code: {hub.demo_bypass_code}
              </p>
            )}

            <div className="form-field">
              <label htmlFor="auth-code" className="form-label">Verification code</label>
              <input
                id="auth-code"
                type="text"
                className="form-input auth-code-input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="------"
                maxLength={6}
                autoFocus
                disabled={loading}
              />
            </div>

            {error && <p className="form-error">{error}</p>}
            {notice && <p className="auth-hint">{notice}</p>}

            <button
              type="submit"
              className="auth-continue-button"
              disabled={loading || !code.trim()}
            >
              {loading ? "Verifying..." : "Verify"}
            </button>

            <button
              type="button"
              className="auth-back-link"
              onClick={handleResendCode}
              disabled={loading}
            >
              Resend code
            </button>
            <button
              type="button"
              className="auth-back-link"
              onClick={() => { setStep("email"); setCode(""); setError(null); setNotice(null); }}
              disabled={loading}
            >
              Use a different email
            </button>
          </form>
        )}

        {/* Step 3: Combined residency + legal acceptance gate
            (Slice 13.9 — new users only; returning residents skip
            this step automatically per handleVerifyCode). */}
        {step === "residency" && (
          <form onSubmit={handleResidency}>
            <h2 className="auth-title">
              {needsResidency ? "One last thing" : "Add your name"}
            </h2>
            <p className="auth-description">
              {needsResidency
                ? hub.residency_intro
                : "Residents now participate under their real name. Your name appears on comments you post (unless you choose to comment anonymously) — votes are always anonymous."}
            </p>

            {needsName && (
              <div className="form-field">
                <label htmlFor="auth-full-name" className="form-label">
                  Full name
                </label>
                <input
                  id="auth-full-name"
                  type="text"
                  className="form-input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jane Doe"
                  maxLength={100}
                  autoComplete="name"
                  autoFocus={!needsResidency}
                  disabled={loading}
                />
                <p className="auth-hint">
                  Please use your real name. It appears next to proposals,
                  votes, and comments you create on the Floyd Civic Hub.
                </p>
              </div>
            )}

            {needsResidency && (
              <label className="auth-checkbox-label auth-legal-checkbox">
                <input
                  type="checkbox"
                  checked={gateChecked}
                  onChange={(e) => setGateChecked(e.target.checked)}
                  disabled={loading}
                />
                <span>
                  I confirm that I am a resident of {hub.jurisdiction}, and
                  I have read and agree to the{" "}
                  <a href="/terms" target="_blank" rel="noopener noreferrer">
                    Terms of Service
                  </a>
                  ,{" "}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer">
                    Privacy Policy
                  </a>
                  , and{" "}
                  <a
                    href="/code-of-conduct"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Code of Conduct
                  </a>
                  .
                </span>
              </label>
            )}

            {error && <p className="form-error">{error}</p>}

            <button
              type="submit"
              className="auth-continue-button"
              disabled={
                loading ||
                (needsResidency && !gateChecked) ||
                (needsName && fullName.trim().length < 2)
              }
            >
              {loading ? "Confirming..." : "Continue"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
