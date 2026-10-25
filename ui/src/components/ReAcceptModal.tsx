// Slice 11 — re-acceptance modal.
//
// Mounts at the app root. When a signed-in user's stored
// `tos_version_accepted` is null OR strictly older than
// CURRENT_LEGAL_VERSION, this modal blocks all interaction with the
// app until the user accepts the new bundle or signs out. Already-
// accepted users see no modal.
//
// The "Sign out instead" button calls AuthContext.logout() — a
// clean exit, no penalty, the user can come back any time. Accepting
// stamps the new version via /auth/accept-tos and dismisses the modal
// so the rest of the page becomes interactive.

import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/authState";
import { LEGAL_PATHS } from "../config/betaPublicPaths";
import { acceptTos } from "../services/auth";
import { useHub } from "../config/hub";
import {
  CURRENT_LEGAL_VERSION,
  CURRENT_LEGAL_LAST_UPDATED,
  legalAcceptanceIsCurrent,
} from "../config/legal";
import Modal from "./Modal";
import TermsNotice from "./TermsNotice";

/**
 * True when the user must be prompted to accept the current legal
 * bundle. Null user / unauthenticated session => no prompt.
 *
 * Comparison is intentionally conservative: anything other than
 * CURRENT_LEGAL_VERSION, or a version a non-material revision replaced
 * (src/shared/legal.ts), counts as out-of-date. We don't try to compare
 * semver.
 */
function needsReAcceptance(
  storedVersion: string | null | undefined,
): boolean {
  return !legalAcceptanceIsCurrent(storedVersion);
}

export default function ReAcceptModal() {
  const hub = useHub();
  const { user, token, updateUser, logout } = useAuth();
  const { pathname } = useLocation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // We only prompt once the user is fully signed in. While loading or
  // unauthenticated, render nothing — the AuthModal handles those.
  if (!user || !token) return null;
  if (!needsReAcceptance(user.tos_version_accepted)) return null;
  // The modal's own links open Terms / Privacy / Code of Conduct in a new
  // tab. That tab is the same signed-in app, so without this gate the modal
  // re-mounted on top of the very page the person clicked through to read
  // (Adam, 2026-09-02). Let the legal pages render bare; the modal is still
  // waiting on every other route.
  if (LEGAL_PATHS.has(pathname)) return null;

  const isFirstAcceptance = user.tos_version_accepted == null;

  async function handleAccept() {
    if (!token) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await acceptTos(token, CURRENT_LEGAL_VERSION);
      updateUser(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record acceptance");
    } finally {
      setSubmitting(false);
    }
  }

  function handleDecline() {
    // Sign-out clears the session cleanly. The AuthModal flow stays
    // available for the user to come back later.
    logout();
  }

  // Must be answered: no ×, and Escape and the backdrop do nothing. The only
  // ways out are accepting or signing out.
  return (
    <Modal
      title={isFirstAcceptance ? "Before you continue…" : "We've updated our Terms"}
      titleClassName="auth-title"
      onClose={() => {}}
      dismissible={false}
      showClose={false}
      role="alertdialog"
      describedBy="re-accept-body"
    >
    <p id="re-accept-body" className="auth-description">
      {isFirstAcceptance
        ? `Before you go on in ${hub.name}, here is what taking part means.`
        : `We've updated the policies for ${hub.name}. Each one starts with a short summary.`}
    </p>

    <TermsNotice verb="continuing" />

    <p className="re-accept-version">
      Version {CURRENT_LEGAL_VERSION} · Last updated{" "}
      {CURRENT_LEGAL_LAST_UPDATED}
    </p>

    {error && <p className="form-error">{error}</p>}

    <div className="re-accept-actions">
      <button
        type="button"
        className="auth-continue-button"
        onClick={handleAccept}
        disabled={submitting}
      >
        {submitting ? "Saving…" : "Continue"}
      </button>
      <button
        type="button"
        className="auth-back-link"
        onClick={handleDecline}
        disabled={submitting}
      >
        Sign out instead
      </button>
    </div>
    </Modal>
  );
}
