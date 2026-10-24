// Auth controller — handles HTTP request/response for auth endpoints
//
// Minimal email-based auth flow:
//   POST /auth/request-code  — send verification code to email
//   POST /auth/verify        — verify code, get session token
//   POST /auth/handoff       — swap the start page's handoff token for a session
//   POST /auth/residency     — affirm Floyd County residency
//   GET  /auth/me            — get current user from session token
//   POST /auth/logout        — destroy session

import { UnauthorizedError, ValidationError } from "../errors/index.js";
import { route } from "../http/route.js";
import type { Request, Response } from "express";
import {
  requestVerification,
  verifyCode,
  verifyLink,
  verifyInviteLink,
  exchangeHandoff,
  affirmResidency,
  acceptLegalTerms,
  updateDisplayName,
  updateFullName,
  updateHideAiDraftingHelp,
  deleteAccount,
  getUserFromToken,
  getSessionFromToken,
  logout,
} from "../modules/civic.auth/index.js";
import { actorFor, SIGNED_OUT } from "../authz/actor.js";
import { authorshipOf } from "../authz/canActor.js";
import { clientIp } from "../utils/clientIp.js";
import { setHiddenFromMembers } from "../services/members.js";

/**
 * POST /auth/request-code
 * Body: { email: string }
 */
export const handleRequestCode = route(async (req, res) => {
  const { email } = req.body ?? {};

  if (!email) throw new ValidationError("Missing required field: email");

  const result = await requestVerification(String(email), clientIp(req));
  res.json(result);
});

/**
 * POST /auth/verify
 * Body: { email: string, code: string, keep_signed_in?: boolean }
 */
export const handleVerify = route(async (req, res) => {
  const { email, code, keep_signed_in } = req.body ?? {};

  if (!email || !code) throw new ValidationError("Missing required fields: email, code");

  const result = await verifyCode(String(email), String(code), clientIp(req), keep_signed_in === true);
  await answerSignedIn(res, result);
});

/**
 * POST /auth/verify-link
 * Body: { token: string, keep_signed_in?: boolean }
 *
 * The code email's "Sign in" link opens /sign-in with the token after `#`;
 * that page posts it here after one Confirm (sign-in slice, 2026-10-14).
 * Same answer shape as /auth/verify.
 */
export const handleVerifyLink = route(async (req, res) => {
  const { token, keep_signed_in } = (req.body ?? {}) as { token?: unknown; keep_signed_in?: unknown };
  const result = await verifyLink(typeof token === "string" ? token : "", clientIp(req), keep_signed_in === true);
  await answerSignedIn(res, result);
});

/**
 * POST /auth/verify-invite
 * Body: { token: string, keep_signed_in?: boolean }
 *
 * A member's invite link (/sign-in#invite=<token>), after the one Confirm.
 * Same answer shape as /auth/verify; a new neighbour goes on to the join step.
 */
export const handleVerifyInvite = route(async (req, res) => {
  const { token, keep_signed_in } = (req.body ?? {}) as { token?: unknown; keep_signed_in?: unknown };
  const result = await verifyInviteLink(typeof token === "string" ? token : "", clientIp(req), keep_signed_in === true);
  await answerSignedIn(res, result);
});

/** The token and user, with role + author_label + office. */
async function answerSignedIn(res: Response, result: { token: string; user: { email: string | null } }): Promise<void> {
  // Include role + author_label + office alongside the token + user so
  // the UI gets the posting-privilege bit and the byline pill without a
  // follow-up /auth/me call.
  const session = await getSessionFromToken(result.token);
  const authorship = await authorshipOf(session ? await actorFor(session.user, session.assurance) : SIGNED_OUT);
  res.json({
    ...result,
    role: authorship?.role ?? null,
    author_label: authorship?.label ?? null,
    official_type: authorship?.official?.type ?? null,
    official_title: authorship?.official?.title ?? null,
  });
}

/**
 * POST /auth/handoff
 * Body: { handoff: string }
 *
 * The start page (session 4b) sends a person who has just created this hub
 * here with a two-minute handoff token in the URL fragment; the page swaps
 * it for an ordinary session. Same answer shape as /auth/verify.
 */
export const handleHandoff = route(async (req, res) => {
  const { handoff } = (req.body ?? {}) as { handoff?: unknown };
  const result = await exchangeHandoff(typeof handoff === "string" ? handoff : "");
  const session = await getSessionFromToken(result.token);
  const authorship = await authorshipOf(session ? await actorFor(session.user, session.assurance) : SIGNED_OUT);
  res.json({
    ...result,
    role: authorship?.role ?? null,
    author_label: authorship?.label ?? null,
    official_type: authorship?.official?.type ?? null,
    official_title: authorship?.official?.title ?? null,
  });
});

/**
 * POST /auth/residency
 * Header: Authorization: Bearer <token>
 * Body: { full_name?: string }
 *
 * The sign-up gate collects the resident's real name alongside the
 * residency affirmation. full_name is required unless the account
 * already has one (pre-policy accounts re-affirming for other reasons).
 */
export const handleAffirmResidency = route(async (req, res) => {
  const token = extractToken(req);
  if (!token) {
    throw new UnauthorizedError("Authentication required");
  }

  const user = await getUserFromToken(token);
  if (!user) {
    throw new UnauthorizedError("Invalid or expired session");
  }

  const { full_name } = (req.body ?? {}) as { full_name?: unknown };
  if (
    !user.full_name &&
    (typeof full_name !== "string" || full_name.trim().length === 0)
  ) {
    throw new ValidationError("full_name is required");
  }

  const updated = await affirmResidency(
    user.id,
    typeof full_name === "string" && full_name.trim().length > 0
      ? full_name
      : undefined,
  );
  res.json({ user: updated });
});

/**
 * GET /auth/me
 * Header: Authorization: Bearer <token>
 */
export const handleGetMe = route(async (req, res) => {
  const token = extractToken(req);
  if (!token) {
    throw new UnauthorizedError("Authentication required");
  }

  const session = await getSessionFromToken(token);
  if (!session) {
    throw new UnauthorizedError("Invalid or expired session");
  }

  // Include the derived role + author label so the UI can gate the admin
  // link, the Post Announcement link, and the author-label display
  // without hardcoding anything. null for residents.
  const authorship = await authorshipOf(await actorFor(session.user, session.assurance));
  res.json({
    user: session.user,
    role: authorship?.role ?? null,
    author_label: authorship?.label ?? null,
    official_type: authorship?.official?.type ?? null,
    official_title: authorship?.official?.title ?? null,
  });
});

/**
 * POST /auth/accept-tos
 * Header: Authorization: Bearer <token>
 * Body: { version: string }
 *
 * Records that the authenticated user has accepted the named version
 * of the Hub's bundled legal documents (Terms / Privacy / Code of
 * Conduct). The UI calls this from both the sign-up acceptance
 * checkbox path and the re-acceptance modal that fires when a user's
 * stored version is older than CURRENT_LEGAL_VERSION. Slice 11.
 */
export const handleAcceptTos = route(async (req, res) => {
  const token = extractToken(req);
  if (!token) {
    throw new UnauthorizedError("Authentication required");
  }
  const user = await getUserFromToken(token);
  if (!user) {
    throw new UnauthorizedError("Invalid or expired session");
  }
  const { version } = (req.body ?? {}) as { version?: unknown };
  if (typeof version !== "string" || version.trim().length === 0) {
    throw new ValidationError("version (string) is required");
  }
  const updated = await acceptLegalTerms(user.id, version.trim());
  res.json({ user: updated });
});

/**
 * PATCH /auth/me
 * Header: Authorization: Bearer <token>
 * Body: { display_name?: string | null, full_name?: string }
 *
 * display_name — role-attribution label (nullable). full_name — the
 * user's real name; used by the re-gate flow for accounts that pre-date
 * the required-name policy. At least one field must be present.
 */
export const handleUpdateProfile = route(async (req, res) => {
  const token = extractToken(req);
  if (!token) {
    throw new UnauthorizedError("Authentication required");
  }
  const user = await getUserFromToken(token);
  if (!user) {
    throw new UnauthorizedError("Invalid or expired session");
  }
  const { display_name, full_name, hide_ai_drafting_help, hidden_from_members } = (req.body ?? {}) as {
    display_name?: unknown;
    full_name?: unknown;
    hide_ai_drafting_help?: unknown;
    hidden_from_members?: unknown;
  };
  const hasDisplayName = display_name !== undefined;
  const hasFullName = full_name !== undefined;
  const hasHideDraftingHelp = hide_ai_drafting_help !== undefined;
  const hasHidden = hidden_from_members !== undefined;
  if (!hasDisplayName && !hasFullName && !hasHideDraftingHelp && !hasHidden) {
    throw new ValidationError("Nothing to update");
  }
  if (hasHidden && typeof hidden_from_members !== "boolean") {
    throw new ValidationError("hidden_from_members must be a boolean");
  }
  if (hasDisplayName && display_name !== null && typeof display_name !== "string") {
    throw new ValidationError("display_name must be a string or null");
  }
  if (hasFullName && typeof full_name !== "string") {
    throw new ValidationError("full_name must be a string");
  }
  if (hasHideDraftingHelp && typeof hide_ai_drafting_help !== "boolean") {
    throw new ValidationError("hide_ai_drafting_help must be a boolean");
  }
  let updated = user;
  if (hasFullName) {
    updated = await updateFullName(user.id, full_name as string);
  }
  if (hasDisplayName) {
    updated = await updateDisplayName(
      user.id,
      typeof display_name === "string" ? display_name : null,
    );
  }
  if (hasHideDraftingHelp) {
    updated = await updateHideAiDraftingHelp(
      user.id,
      hide_ai_drafting_help as boolean,
    );
  }
  if (hasHidden) {
    // Members page and avatar stack (members and invites slice).
    await setHiddenFromMembers(user.id, hidden_from_members as boolean);
    updated = { ...updated, hidden_from_members: hidden_from_members as boolean };
  }
  res.json({ user: updated });
});

/**
 * POST /auth/logout
 * Header: Authorization: Bearer <token>
 */
export const handleLogout = route(async (req, res) => {
  const token = extractToken(req);
  if (token) {
    await logout(token);
  }
  res.json({ message: "Logged out" });
});

/**
 * DELETE /auth/me
 * Header: Authorization: Bearer <token>
 *
 * Slice 13.11 — self-service account deletion. Resolves the bearer
 * token to a user, then removes the user row + sign_in_codes
 * for that email. Sessions cascade. Public-record references
 * (comments, endorsements, vote-participation) are intentionally
 * orphaned, not deleted — see deleteAccount() doc comment.
 */
export const handleDeleteAccount = route(async (req, res) => {
  const token = extractToken(req);
  if (!token) {
    throw new UnauthorizedError("Authentication required");
  }
  const user = await getUserFromToken(token);
  if (!user) {
    throw new UnauthorizedError("Invalid or expired session");
  }
  await deleteAccount(user.id, user.email);
  res.json({ message: "Account deleted" });
});

// --- Helpers ---

function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}
