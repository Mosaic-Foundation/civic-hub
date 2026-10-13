import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { pluginEnabled } from "../config/plugins";
import { onboardingTarget } from "../config/pluginRules";
import {
  requestCode,
  verifyCode,
  rememberedKeepSignedIn,
  rememberKeepSignedIn,
  affirmResidency,
  updateFullName,
  acceptTos,
  type AuthRole,
  type AuthUser,
} from "../services/auth";
import { CURRENT_LEGAL_VERSION } from "../config/legal";
import hub from "../config/hub";
import Modal from "./Modal";
import TermsNotice from "./TermsNotice";
import WaitlistForm from "./WaitlistForm";
import { affiliationClause, pluralNoun } from "../../../src/shared/hubKind";

/**
 * Slice 13.10: deferred login() until the residency + legal gate
 * passes. Prevents users from ending up with a partial session if
 * they close the modal between code verification and the gate.
 */
export interface PendingAuth {
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
export function officialFrom(result: {
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
  /**
   * Already verified, not yet joined: the email's sign-in link page hands
   * its answer here, and the modal opens at the join step (sign-in slice).
   */
  pending?: PendingAuth;
}

export default function AuthModal({ onComplete, onDismiss, pending }: Props) {
  const { user, token, login, updateUser, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(() => {
    // Any verified user lands on the gate step — it renders only the
    // pieces they're missing (residency checkbox and/or name field),
    // and auto-completes when nothing is missing.
    if (pending || (user && user.email_verified)) return "residency";
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
  const [pendingAuth, setPendingAuth] = useState<PendingAuth | null>(pending ?? null);
  // The residency checkbox (Slice 13.9). The policies are no longer a
  // checkbox (sign-in slice, Adam 2026-10-13): a one-line notice beside Join
  // says that joining agrees to them. Returning residents skip this step;
  // the app-root ReAcceptModal catches a stale legal version.
  const [gateChecked, setGateChecked] = useState(false);
  // "Keep me signed in": off unless this browser remembers it ticked.
  const [keepSignedIn, setKeepSignedIn] = useState(rememberedKeepSignedIn);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * The server sent no email (a demo hub, an ordinary visitor): any six
   * digits sign in, and the code step must not say "Check your email"
   * (review R22). The server decides — an admin on a demo hub gets a code.
   */
  const [noEmail, setNoEmail] = useState(false);
  // Set when the backend rejects the email because the hub is in private
  // beta and the address isn't on the allow-list. Instead of a dead-end
  // error we swap the email form for a waitlist capture.
  const [betaBlocked, setBetaBlocked] = useState(false);

  // If user is already fully authenticated + resident + named, just complete
  useEffect(() => {
    if (user && user.email_verified && user.is_resident && user.full_name) {
      onComplete();
    }
  }, [user, onComplete]);

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }

    setLoading(true);
    try {
      // The server decides what to say here. A demo hub answers "enter any six
      // digits" and emails nothing; an ordinary hub answers with the usual
      // "we sent a code". The client holds no demo flag and no bypass code —
      // there is nothing to hold, since a demo hub accepts any six digits.
      const { no_email } = await requestCode(email.trim());
      setNoEmail(no_email === true);
      // On a demo hub the code is filled in and Verify is ready (Adam,
      // 2026-10-11): people skim past "no email is sent" and go looking for
      // one. Any six digits work, so these do; they can type others.
      if (no_email === true) setCode("123456");
      setStep("code");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to send code";
      // The beta allow-list gate rejects unknown emails at the request-code
      // step (civic.auth requestVerification), code `beta_closed`. Turn that
      // into a waitlist invitation rather than a red error the visitor can't act on.
      if ((err as { code?: unknown } | null)?.code === "beta_closed") {
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
      setNotice("We sent another code. Any code we sent in the last ten minutes works.");
    } catch (err) {
      // The server says when to try again, in the hub's time ("We just sent
      // you a code. You can ask for another after 4:10 PM.").
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
      rememberKeepSignedIn(keepSignedIn);
      const result = await verifyCode(email.trim(), code.trim(), keepSignedIn);

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
  // Residence, membership or nothing, by the hub's kind (identity.hub_kind).
  // An admin affirms none of them: they run the hub, and may not live there
  // (review R23). A demo hub asks only that the visitor is trying the demo,
  // so no copy saying the place is made up sits above "I am a resident of".
  const gateIsAdmin = pendingAuth ? pendingAuth.role === "admin" : isAdmin;
  const affirmation = gateIsAdmin
    ? null
    : hub.demo_mode
      ? "I'm trying this demo"
      : affiliationClause(hub.kind, { place: hub.jurisdiction, hub: hub.name });
  const needsName = !gateUser?.full_name;
  // The policies notice shows to anyone who hasn't agreed to this version: a
  // hub's creator agreed once, at creation, and doesn't see it again.
  const needsTerms = gateUser?.tos_version_accepted !== CURRENT_LEGAL_VERSION;

  async function handleResidency(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (needsName && fullName.trim().length < 2) {
      setError("Please enter your full name.");
      return;
    }
    if (needsResidency && affirmation && !gateChecked) {
      setError("Please tick the box to confirm.");
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
        // Join: affirm residency (+ name), and record that joining agreed
        // to the policies the notice beside the button names. acceptTos
        // failure is non-fatal — the re-acceptance modal will catch them
        // on next page load.
        const residencyResult = await affirmResidency(
          tokenToUse,
          needsName ? fullName.trim() : undefined,
        );
        nextUser = residencyResult.user;
        if (needsTerms) {
          try {
            const accepted = await acceptTos(tokenToUse, CURRENT_LEGAL_VERSION);
            nextUser = accepted.user;
          } catch (acceptErr) {
            console.warn(
              "[auth] accept-tos failed during sign-up; re-acceptance modal will retry.",
              acceptErr,
            );
          }
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
        // First-time signup — route to the onboarding word cloud if configured
        // and Word clouds is on; otherwise they stay where they are.
        //
        // KEEPING THEIR PLACE (review R24). This used to be a full page load
        // to the word cloud, which dropped whatever asked for sign-in — the
        // vote option they clicked — and the cloud's Skip went home. Now the
        // waiting action runs first (the vote is cast while this page still
        // holds it), then an in-app move to the cloud carries this page's
        // address, and Skip / Continue bring them back to it.
        if (needsResidency) {
          const here = `${window.location.pathname}${window.location.search}`;
          const target = onboardingTarget(hub.onboarding_wordcloud_id, pluginEnabled("wordcloud"), here);
          if (target) {
            onComplete();
            navigate(target);
            return;
          }
        }
      } else {
        updateUser(nextUser);
      }
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Each step names itself; the Modal labels the dialog with it.
  const title =
    step === "email"
      ? betaBlocked
        ? "We're in private beta"
        : "Sign in or create an account"
      : step === "code"
        ? noEmail
          ? "Enter any six digits"
          : "Check your email"
        : needsResidency
          ? "One last thing"
          : "Add your name";

  return (
    // Slice 13.9: clicking the backdrop does NOT dismiss the modal.
    // Users must use the X close button (or Escape) so accidental
    // outside-clicks don't lose form state mid-sign-up.
    <Modal
      title={title}
      titleClassName="auth-title"
      className="auth-modal"
      onClose={onDismiss}
      closeOnBackdrop={false}
    >
    {/* Private-beta fallback: the entered email isn't on the allow-list.
        Offer the waitlist instead of a dead-end error. */}
    {step === "email" && betaBlocked && (
      <div className="auth-beta-blocked">
        <p className="auth-description">
          {hub.name} isn't open for general sign-ups yet. Join the waitlist
          and we'll email you the moment access opens up.
        </p>
        <WaitlistForm initialEmail={email} />
        <button
          type="button"
          className="auth-back-link"
          onClick={() => { setBetaBlocked(false); setError(null); }}
        >
          Back to sign in
        </button>
      </div>
    )}

    {/* Step 1: Email */}
    {step === "email" && !betaBlocked && (
      <form onSubmit={handleRequestCode}>
        {/* One passwordless flow serves returning and new users alike
            (the server only learns which after the code verifies), so
            the title names both. The supporting copy is beta-aware:
            during the private beta it speaks to invited testers and
            points everyone else at the waitlist; when beta_mode flips
            off the same step reads as plain sign-in / sign-up. */}
        <p className="auth-description">
          {hub.beta_mode
            ? "Beta testers: enter the email address you were invited with and we'll send you a one-time code."
            : hub.demo_mode
              ? "Enter your email to try this demo hub. No password needed."
              : "Enter your email and we'll send you a one-time code. No password needed."}
        </p>

        <div className="form-field">
          <label htmlFor="auth-email" className="form-label">Email</label>
          <input
            id="auth-email"
            type="email"
            inputMode="email"
            autoComplete="email"
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

        {hub.beta_mode ? (
          <p className="auth-footnote">
            Not on the beta list yet?{" "}
            <button
              type="button"
              className="auth-inline-link"
              onClick={() => { setBetaBlocked(true); setError(null); }}
              disabled={loading}
            >
              Join the waitlist
            </button>
          </p>
        ) : (
          <p className="auth-footnote">
            New here? Same step — your account is created when you verify
            the code.
          </p>
        )}
      </form>
    )}

    {/* Step 2: Verify code */}
    {step === "code" && (
      <form onSubmit={handleVerifyCode}>
        {noEmail ? (
          <>
            <p className="auth-description">
              On a live hub you would get a six-digit code by email. This is
              a demo, so <strong>no email is sent: any six digits work</strong>.
              We've filled some in. Press Verify to sign in as {email}.
            </p>
          </>
        ) : (
          <>
            <p className="auth-description">
              We sent a 6-digit code to <strong>{email}</strong>
            </p>
          </>
        )}

        <div className="form-field">
          <label htmlFor="auth-code" className="form-label">Verification code</label>
          {/* What iOS and Android need to offer the code from the email or
              a text above the keyboard: one-time-code, and a number pad. */}
          <input
            id="auth-code"
            name="one-time-code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            className="form-input auth-code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="------"
            maxLength={6}
            autoFocus={!noEmail}
            disabled={loading}
          />
        </div>

        <label className="auth-checkbox-label auth-keep-signed-in">
          <input
            type="checkbox"
            checked={keepSignedIn}
            onChange={(e) => setKeepSignedIn(e.target.checked)}
            disabled={loading}
          />
          <span>Keep me signed in on this device</span>
        </label>

        {error && <p className="form-error">{error}</p>}
        {notice && <p className="auth-hint">{notice}</p>}

        <button
          type="submit"
          className="auth-continue-button"
          disabled={loading || !code.trim()}
          // On a demo hub the code is already there: Verify is the next step.
          autoFocus={noEmail}
        >
          {loading ? "Verifying..." : "Verify"}
        </button>

        {!noEmail && (
          <button
            type="button"
            className="auth-back-link"
            onClick={handleResendCode}
            disabled={loading}
          >
            Resend code
          </button>
        )}
        <button
          type="button"
          className="auth-back-link"
          onClick={() => { setStep("email"); setCode(""); setNoEmail(false); setError(null); setNotice(null); }}
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
        <p className="auth-description">
          {needsResidency
            ? gateIsAdmin
              ? "Please review the policies below."
              : hub.residency_intro
            : `${pluralNoun(hub.person_label)} now take part under their real name. Your name appears on comments you post (unless you choose to comment anonymously) — votes are always anonymous.`}
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
              votes, and comments you create on {hub.name}.
            </p>
          </div>
        )}

        {needsResidency && affirmation && (
          <label className="auth-checkbox-label auth-legal-checkbox">
            <input
              type="checkbox"
              checked={gateChecked}
              onChange={(e) => setGateChecked(e.target.checked)}
              disabled={loading}
            />
            <span>{affirmation}.</span>
          </label>
        )}

        {error && <p className="form-error">{error}</p>}

        <button
          type="submit"
          className="auth-continue-button"
          disabled={
            loading ||
            (needsResidency && !!affirmation && !gateChecked) ||
            (needsName && fullName.trim().length < 2)
          }
        >
          {loading ? (needsResidency ? "Joining..." : "Saving...") : needsResidency ? "Join" : "Continue"}
        </button>
        {needsResidency && needsTerms && <TermsNotice verb="joining" />}
      </form>
    )}
    </Modal>
  );
}
